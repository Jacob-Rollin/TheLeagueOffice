import { ActiveLeagueLabel } from "@/components/league/ActiveLeagueLabel";
import { PlaybookShell } from "@/components/playbook/PlaybookShell";
import { PositionBadge } from "@/components/draft/PositionBadge";
import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useActiveStandings } from "@/hooks/useActiveStandings";
import { useDraft } from "@/hooks/use-draft";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { TradeSideCompare } from "@/components/trade/TradeSideCompare";
import { queryOptions, useQueries, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeftRight, BarChart3, ChevronDown, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { rosterSize, teamName, type Player, type Scoring } from "@/lib/draft";
import { grade } from "@/lib/evaluate";
import { loadPlayersCatalog } from "@/lib/players-catalog";
import { getPlayerDetail } from "@/lib/players.functions";
import type { PlayerDetail } from "@/lib/players.server";
import {
  POWER_INDEX_CEIL,
  POWER_INDEX_FLOOR,
  buildTruePowerRankings,
  starterRequirements,
} from "@/lib/power-rankings";
import { seasonPositionRoomRanks, topNeedsFromSeasonPosRanks } from "@/lib/position-room-ranks";
import { buildSandboxTeams, injuryMicroBadge, resolveInjuryStatus } from "@/lib/sandbox-rosters";
import { fetchSnapTradeValueBasis } from "@/lib/snap-cdn";
import {
  benchSlotWarning,
  blendAnalyzerGrade,
  executiveSummary,
  headlineVerdict,
  injuryRisk,
  needFitAdjustment,
  needFitNote,
  opponentImpact as computeOpponentImpact,
  packageScore,
  positionalDepth,
  powerDeltaToGradePct,
  rosterConstraint,
  rosterFit,
  scaleValue,
  sideBullets,
  type AnalyzerGradeParts,
  type Bullet,
  type BulletAsset,
  type FitPlayer,
  type InjuryRisk,
  type PositionalDepthRow,
} from "@/lib/trade-engine";
import { inSeasonWeeklyValue } from "@/lib/trade-value";
import { cn } from "@/lib/utils";

/** Matches roster cards: left column | center gap (swap width) | right column. */
const ANALYZER_SPLIT =
  "grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-[minmax(0,1fr)_2.75rem_minmax(0,1fr)]";

const playersQuery = queryOptions({
  queryKey: ["players-catalog"],
  queryFn: () => loadPlayersCatalog(),
  staleTime: 1000 * 60 * 30,
});

const detailQuery = (id: string) =>
  queryOptions({
    queryKey: ["player", id, "client-v1"],
    queryFn: async () => {
      const { hydratePlayerBrain } = await import("@/lib/playerBrainHydration");
      const { fetchPlayerDetailClient } = await import("@/lib/player-detail-client");
      const brain = await hydratePlayerBrain().catch(() => null);
      const client = await fetchPlayerDetailClient(id, brain);
      if (client) return client;
      try {
        if (import.meta.env.PROD) return null;
      } catch {
        /* ignore */
      }
      return getPlayerDetail({ data: { id } });
    },
    staleTime: 1000 * 60 * 30,
    retry: false,
  });

export const Route = createFileRoute("/trade-analyzer")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Trade Analyzer — The League Office" },
      {
        name: "description",
        content:
          "Side-by-side fantasy football trade analyzer with power ranks, positional needs, and live trade grades.",
      },
    ],
  }),
  loader: ({ context }) => {
    void context.queryClient.ensureQueryData(playersQuery);
  },
  component: TradeAnalyzerRoute,
});

type AnalyzerTeam = {
  key: string;
  name: string;
  owner: string;
  logo: string | null;
  slot: number;
  players: Player[];
};

function TradeAnalyzerRoute() {
  const { activeLeagueId } = useActiveLeague();
  return (
    <PlaybookShell wide section="trade">
      <TradeAnalyzerPage key={activeLeagueId ?? "none"} />
    </PlaybookShell>
  );
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return name;
  const first = parts[0]![0] ?? "";
  return `${first}. ${parts[parts.length - 1]}`;
}

/** Season-to-date pos rank label (same source as player popups), ADP fallback. */
function posRankLabel(player: Player, seasonPosRank: number | null | undefined): string {
  const pos = player.pos === "DEF" ? "DST" : player.pos;
  const ytd = seasonPosRank != null && seasonPosRank > 0 ? seasonPosRank : null;
  const fallback = player.posRank > 0 && player.posRank < 999 ? player.posRank : null;
  const rank = ytd ?? fallback;
  return rank != null ? `${pos} ${rank}` : pos;
}

/** Roster list order: QB → RB → WR → TE → K → DST. */
const ROSTER_POS_ORDER: Record<string, number> = {
  QB: 0,
  RB: 1,
  WR: 2,
  TE: 3,
  K: 4,
  DEF: 5,
  DST: 5,
};

function sortPlayersByPos(players: Player[]): Player[] {
  return [...players].sort((a, b) => {
    const pa = ROSTER_POS_ORDER[String(a.pos ?? "").toUpperCase()] ?? 99;
    const pb = ROSTER_POS_ORDER[String(b.pos ?? "").toUpperCase()] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });
}

/** Map a power index onto the 0–100 meter using the soft display band. */
function powerMeterPct(power: number | null): number {
  if (power == null) return 50;
  const span = POWER_INDEX_CEIL - POWER_INDEX_FLOOR || 1;
  return Math.max(4, Math.min(96, ((power - POWER_INDEX_FLOOR) / span) * 100));
}

function TradeAnalyzerPage() {
  const { data } = useSuspenseQuery(playersQuery);
  const { activeLeague, sandboxMode } = useActiveLeague();
  const draft = useDraft();
  const brain = usePlayerBrain();
  const modalRef = useRef<PlayerModalHandle>(null);

  const league = useLeagueRosters(data.players);
  const { format: leagueFormat, projectFor, rankFor } = useLeagueProjections();
  const { standings } = useActiveStandings();
  const valueScoring: Scoring = league?.synced ? (leagueFormat as Scoring) : draft.settings.scoring;
  const seasonPosRankFor = useCallback(
    (playerId: string) => rankFor(playerId, valueScoring).pos,
    [rankFor, valueScoring],
  );

  const { data: valueBasis } = useQuery({
    queryKey: ["trade-value-basis"],
    queryFn: () => fetchSnapTradeValueBasis(),
    staleTime: 30 * 60 * 1000,
  });

  const weeklyOf = useCallback(
    (p: Player) =>
      inSeasonWeeklyValue(
        valueBasis?.players?.[p.id],
        valueBasis ?? null,
        p.proj?.[valueScoring] ?? 0,
        valueScoring,
      ).weekly,
    [valueBasis, valueScoring],
  );

  const fitOf = useCallback(
    (p: Player): FitPlayer => ({
      id: p.id,
      pos: p.pos,
      weekly: weeklyOf(p),
    }),
    [weeklyOf],
  );

  const byId = useMemo(() => new Map(data.players.map((p) => [p.id, p])), [data.players]);
  const rostersByTeam = useMemo(() => {
    const map = new Map<number, Player[]>();
    for (let t = 1; t <= draft.settings.teams; t++) map.set(t, []);
    for (const pick of draft.picks) {
      const player = byId.get(pick.playerId);
      if (!player) continue;
      map.get(pick.team)?.push(player);
    }
    return map;
  }, [draft.picks, draft.settings.teams, byId]);

  const hasDraftPicks = draft.picks.length > 0;
  const sandboxTeams = useMemo(
    () => (sandboxMode && !hasDraftPicks ? buildSandboxTeams(data.players) : null),
    [sandboxMode, hasDraftPicks, data.players],
  );

  const allTeams = useMemo<AnalyzerTeam[]>(() => {
    if (sandboxMode) {
      if (sandboxTeams) {
        return [
          {
            key: "mine",
            name: "My Team",
            owner: "",
            logo: null,
            slot: draft.settings.myTeam,
            players: sandboxTeams.myTeam,
          },
          ...sandboxTeams.rivalTeams.map((t, i) => ({
            key: t.key,
            name: t.name,
            owner: t.owner,
            logo: null,
            slot: i + 2,
            players: t.players,
          })),
        ];
      }
      return [...rostersByTeam.keys()]
        .sort((a, b) => a - b)
        .map((t) => ({
          key: `t${t}`,
          name: teamName(draft.settings, t),
          owner: "",
          logo: null,
          slot: t,
          players: rostersByTeam.get(t) ?? [],
        }));
    }
    if (league?.synced && league.teams.length) {
      return league.teams.map((t) => ({
        key: `s${t.slot}`,
        name: t.team,
        owner: t.owner,
        logo: t.logo,
        slot: t.slot,
        players: t.players,
      }));
    }
    return [...rostersByTeam.keys()]
      .sort((a, b) => a - b)
      .map((t) => ({
        key: `t${t}`,
        name: teamName(draft.settings, t),
        owner: "",
        logo: null,
        slot: t,
        players: rostersByTeam.get(t) ?? [],
      }));
  }, [sandboxMode, sandboxTeams, league?.synced, league?.teams, rostersByTeam, draft.settings]);

  const myKey = useMemo(() => {
    if (sandboxMode) {
      if (sandboxTeams) return "mine";
      return `t${draft.settings.myTeam}`;
    }
    const mine = allTeams.find((t) =>
      league?.synced
        ? league.teams.some((lt) => lt.slot === t.slot && lt.isMine)
        : t.key === `t${draft.settings.myTeam}`,
    );
    return mine?.key ?? allTeams[0]?.key ?? "";
  }, [sandboxMode, sandboxTeams, draft.settings.myTeam, allTeams, league?.synced, league?.teams]);

  const [leftKey, setLeftKey] = useState("");
  const [rightKey, setRightKey] = useState("");
  const [giveIds, setGiveIds] = useState<string[]>([]);
  const [getIds, setGetIds] = useState<string[]>([]);
  const [extraGive, setExtraGive] = useState<Player[]>([]);
  const [extraGet, setExtraGet] = useState<Player[]>([]);
  const [leftSearchQ, setLeftSearchQ] = useState("");
  const [rightSearchQ, setRightSearchQ] = useState("");

  useEffect(() => {
    setGiveIds([]);
    setGetIds([]);
    setExtraGive([]);
    setExtraGet([]);
    setLeftSearchQ("");
    setRightSearchQ("");
  }, [activeLeague?.id, sandboxMode]);

  useEffect(() => {
    if (!allTeams.length) return;
    setLeftKey((prev) =>
      prev && allTeams.some((t) => t.key === prev) ? prev : myKey || allTeams[0]!.key,
    );
    setRightKey((prev) => {
      if (prev && allTeams.some((t) => t.key === prev) && prev !== (myKey || allTeams[0]!.key))
        return prev;
      const rival = allTeams.find((t) => t.key !== (myKey || allTeams[0]!.key));
      return rival?.key ?? allTeams[1]?.key ?? allTeams[0]!.key;
    });
  }, [allTeams, myKey]);

  const leftTeam = allTeams.find((t) => t.key === leftKey) ?? null;
  const rightTeam = allTeams.find((t) => t.key === rightKey) ?? null;

  const starters = useMemo(() => {
    if (league?.synced && league.rosterPositions.length) {
      return starterRequirements(league.rosterPositions);
    }
    return draft.settings.roster as unknown as Record<string, number>;
  }, [league?.synced, league?.rosterPositions, draft.settings.roster]);

  const give = useMemo(() => {
    const fromRoster = (leftTeam?.players ?? []).filter((p) => giveIds.includes(p.id));
    const extras = extraGive.filter((p) => !fromRoster.some((r) => r.id === p.id));
    return [...fromRoster, ...extras];
  }, [leftTeam, giveIds, extraGive]);

  const get = useMemo(() => {
    const fromRoster = (rightTeam?.players ?? []).filter((p) => getIds.includes(p.id));
    const extras = extraGet.filter((p) => !fromRoster.some((r) => r.id === p.id));
    return [...fromRoster, ...extras];
  }, [rightTeam, getIds, extraGet]);

  const selectedForDetails = useMemo(() => [...give, ...get], [give, get]);
  const details = useQueries({
    queries: selectedForDetails.map((p) => detailQuery(p.id)),
    combine: (results) => {
      const map = new Map<string, PlayerDetail>();
      results.forEach((r, i) => {
        const id = selectedForDetails[i]?.id;
        if (id && r.data) map.set(id, r.data);
      });
      return { map, loading: results.some((r) => r.isLoading) };
    },
  });

  const toggleGive = (player: Player) => {
    setGiveIds((ids) =>
      ids.includes(player.id) ? ids.filter((id) => id !== player.id) : [...ids, player.id],
    );
    setExtraGive((list) => list.filter((p) => p.id !== player.id));
  };

  const toggleGet = (player: Player) => {
    setGetIds((ids) =>
      ids.includes(player.id) ? ids.filter((id) => id !== player.id) : [...ids, player.id],
    );
    setExtraGet((list) => list.filter((p) => p.id !== player.id));
  };

  const clearGive = () => {
    setGiveIds([]);
    setExtraGive([]);
  };
  const clearGet = () => {
    setGetIds([]);
    setExtraGet([]);
  };

  const blockedIds = useMemo(
    () => new Set([...give.map((p) => p.id), ...get.map((p) => p.id)]),
    [give, get],
  );

  const leftSearchResults = useMemo(() => {
    const term = leftSearchQ.trim().toLowerCase();
    if (term.length < 2) return [];
    return data.players
      .filter((p) => p.name.toLowerCase().includes(term) && !blockedIds.has(p.id))
      .slice(0, 8);
  }, [leftSearchQ, data.players, blockedIds]);

  const rightSearchResults = useMemo(() => {
    const term = rightSearchQ.trim().toLowerCase();
    if (term.length < 2) return [];
    return data.players
      .filter((p) => p.name.toLowerCase().includes(term) && !blockedIds.has(p.id))
      .slice(0, 8);
  }, [rightSearchQ, data.players, blockedIds]);

  const addToGive = (player: Player) => {
    if (leftTeam?.players.some((p) => p.id === player.id)) {
      setGiveIds((ids) => (ids.includes(player.id) ? ids : [...ids, player.id]));
    } else {
      setExtraGive((list) => (list.some((p) => p.id === player.id) ? list : [...list, player]));
    }
    setLeftSearchQ("");
  };

  const addToGet = (player: Player) => {
    if (rightTeam?.players.some((p) => p.id === player.id)) {
      setGetIds((ids) => (ids.includes(player.id) ? ids : [...ids, player.id]));
    } else {
      setExtraGet((list) => (list.some((p) => p.id === player.id) ? list : [...list, player]));
    }
    setRightSearchQ("");
  };

  const projectWeekly = useCallback(
    (playerId: string) => {
      const live = projectFor?.(playerId);
      if (live != null && Number.isFinite(live)) return live;
      const p = byId.get(playerId);
      return p ? weeklyOf(p) : 0;
    },
    [projectFor, byId, weeklyOf],
  );

  const powerRows = useMemo(() => {
    if (!allTeams.length) return [];
    const standingBySlot = new Map((standings?.rows ?? []).map((r) => [r.rosterId, r]));
    const inputs = allTeams.map((team) => {
      const standing = standingBySlot.get(team.slot);
      return {
        slot: team.slot,
        team: team.name,
        owner: team.owner,
        players: team.players,
        wins: standing?.wins ?? 0,
        losses: standing?.losses ?? 0,
        ties: standing?.ties ?? 0,
        pointsFor: standing?.pointsFor ?? 0,
      };
    });
    return buildTruePowerRankings(inputs, {
      brain,
      projectFor: projectWeekly,
      rosterPositions: league?.rosterPositions?.length
        ? league.rosterPositions
        : Object.entries(starters).flatMap(([pos, n]) => Array(n).fill(pos)),
    });
  }, [allTeams, standings, brain, league?.rosterPositions, starters, projectWeekly]);

  const powerAfter = useMemo(() => {
    if (!leftTeam || !rightTeam || (!give.length && !get.length)) return null;
    const giveSet = new Set(give.map((p) => p.id));
    const getSet = new Set(get.map((p) => p.id));
    const standingBySlot = new Map((standings?.rows ?? []).map((r) => [r.rosterId, r]));
    const inputs = allTeams.map((team) => {
      const standing = standingBySlot.get(team.slot);
      let players = team.players;
      if (team.key === leftTeam.key) {
        players = [
          ...team.players.filter((p) => !giveSet.has(p.id)),
          ...get.filter((p) => !team.players.some((r) => r.id === p.id)),
        ];
      } else if (team.key === rightTeam.key) {
        players = [
          ...team.players.filter((p) => !getSet.has(p.id)),
          ...give.filter((p) => !team.players.some((r) => r.id === p.id)),
        ];
      }
      return {
        slot: team.slot,
        team: team.name,
        owner: team.owner,
        players,
        wins: standing?.wins ?? 0,
        losses: standing?.losses ?? 0,
        ties: standing?.ties ?? 0,
        pointsFor: standing?.pointsFor ?? 0,
      };
    });
    return buildTruePowerRankings(inputs, {
      brain,
      projectFor: projectWeekly,
      rosterPositions: league?.rosterPositions?.length
        ? league.rosterPositions
        : Object.entries(starters).flatMap(([pos, n]) => Array(n).fill(pos)),
    });
  }, [
    leftTeam,
    rightTeam,
    give,
    get,
    allTeams,
    standings,
    brain,
    league?.rosterPositions,
    starters,
    projectWeekly,
  ]);

  const leftPower = powerRows.find((r) => r.slot === leftTeam?.slot);
  const rightPower = powerRows.find((r) => r.slot === rightTeam?.slot);
  const leftPowerAfter = powerAfter?.find((r) => r.slot === leftTeam?.slot);
  const rightPowerAfter = powerAfter?.find((r) => r.slot === rightTeam?.slot);

  const tradePending = give.length > 0 || get.length > 0;
  const leftDisplayPower =
    tradePending && leftPowerAfter ? leftPowerAfter.powerIndex : (leftPower?.powerIndex ?? null);
  const rightDisplayPower =
    tradePending && rightPowerAfter ? rightPowerAfter.powerIndex : (rightPower?.powerIndex ?? null);
  const leftDelta =
    leftPower && leftPowerAfter && tradePending
      ? Math.round((leftPowerAfter.powerIndex - leftPower.powerIndex) * 10) / 10
      : null;
  const rightDelta =
    rightPower && rightPowerAfter && tradePending
      ? Math.round((rightPowerAfter.powerIndex - rightPower.powerIndex) * 10) / 10
      : null;

  const seasonRoomRanks = useMemo(
    () =>
      seasonPositionRoomRanks(
        allTeams.map((t) => ({ rosterId: t.slot, players: t.players })),
        starters,
        seasonPosRankFor,
      ),
    [allTeams, starters, seasonPosRankFor],
  );

  const needsByKey = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const team of allTeams) {
      map.set(
        team.key,
        topNeedsFromSeasonPosRanks(
          team.slot,
          team.players,
          seasonRoomRanks,
          starters,
          seasonPosRankFor,
          3,
        ),
      );
    }
    return map;
  }, [allTeams, starters, seasonRoomRanks, seasonPosRankFor]);

  const recordBySlot = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of standings?.rows ?? []) {
      const wins = Number(row.wins ?? 0);
      const losses = Number(row.losses ?? 0);
      const ties = Number(row.ties ?? 0);
      map.set(row.rosterId, ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`);
    }
    return map;
  }, [standings]);

  const leftNeeds = needsByKey.get(leftTeam?.key ?? "") ?? [];
  const rightNeeds = needsByKey.get(rightTeam?.key ?? "") ?? [];

  /* ---------- Trade engine (same math as Trade Desk) ---------- */
  const userRoster = useMemo(() => leftTeam?.players ?? [], [leftTeam]);
  const rivalRoster = useMemo(() => rightTeam?.players ?? [], [rightTeam]);
  const ready = give.length > 0 && get.length > 0;
  const isSandbox = sandboxMode || !league?.synced || userRoster.length === 0;
  const valueOnly = isSandbox;

  const giveWeekly = packageScore(
    give.map((p) => weeklyOf(p)),
    get.length,
  );
  const rawGetWeekly = packageScore(
    get.map((p) => weeklyOf(p)),
    give.length,
  );

  const rosterCap = rosterSize(draft.settings.roster);
  const benchPool = useMemo(
    () =>
      userRoster
        .filter((p) => !give.some((g) => g.id === p.id))
        .concat(get)
        .map((p) => ({ name: p.name, pos: p.pos, weekly: weeklyOf(p) })),
    [userRoster, give, get, weeklyOf],
  );
  const constraint = rosterConstraint({
    rosterCount: userRoster.length,
    rosterCap,
    giveCount: give.length,
    getCount: get.length,
    bench: benchPool,
    starters,
  });
  const getWeekly = Math.max(0, rawGetWeekly - constraint.penalty);

  const fit = useMemo(
    () =>
      rosterFit({
        roster: userRoster.map(fitOf),
        give: give.map(fitOf),
        get: get.map(fitOf),
        starters,
      }),
    [userRoster, give, get, starters, fitOf],
  );
  const impact = fit.impact;

  const rivalImpact = useMemo(() => {
    if (!rivalRoster.length || !give.length || !get.length) return null;
    return computeOpponentImpact({
      roster: rivalRoster.map(fitOf),
      give: give.map(fitOf),
      get: get.map(fitOf),
      starters,
    });
  }, [rivalRoster, give, get, starters, fitOf]);

  const marketValue = (list: Player[]) =>
    list.reduce((s, p) => s + Math.max(0, brain?.[p.id]?.value ?? 0), 0);
  const giveValue = marketValue(give);
  const getValue = marketValue(get);
  const valueTilt =
    giveValue + getValue > 0
      ? ((getValue - giveValue) / Math.max(giveValue, getValue, 1)) * 100
      : ((getWeekly - giveWeekly) / Math.max(giveWeekly, getWeekly, 0.01)) * 100;

  /**
   * FantasyPros-style blend: 50% power Δ + 35% lineup fit + 15% Top-Needs fit.
   * Sandbox stays market-value only (no synced roster / power context).
   */
  const powerGradePct =
    ready && !isSandbox
      ? powerDeltaToGradePct(leftPower?.powerIndex, leftPowerAfter?.powerIndex)
      : null;
  const needFitPct = useMemo(
    () =>
      needFitAdjustment({
        topNeeds: leftNeeds,
        getPositions: get.map((p) => p.pos),
        givePositions: give.map((p) => p.pos),
        fills: fit.fills,
        clogs: fit.clogs,
      }),
    [leftNeeds, get, give, fit.fills, fit.clogs],
  );
  const blended = useMemo(() => {
    if (isSandbox) {
      return {
        pct: valueTilt,
        usedPower: false,
        parts: { power: 0, lineup: 0, needFit: 0 } as AnalyzerGradeParts,
      };
    }
    return blendAnalyzerGrade({
      powerPct: powerGradePct,
      lineupPct: fit.pct,
      needFitPct,
    });
  }, [isSandbox, valueTilt, powerGradePct, fit.pct, needFitPct]);

  let adjustedPct = blended.pct;
  // Clear starting-lineup upgrades should not grade worse than the fit signal alone.
  if (!isSandbox && impact.delta > 0.25) adjustedPct = Math.max(adjustedPct, fit.pct);
  if (!isSandbox && impact.delta > 2) adjustedPct = Math.max(adjustedPct, 15);

  const adjustedGrade = grade(adjustedPct);
  const benchSlotsRequired = Math.max(0, get.length - give.length);
  const needsNote = !isSandbox
    ? needFitNote({
        topNeeds: leftNeeds,
        getPositions: get.map((p) => p.pos),
        givePositions: give.map((p) => p.pos),
        needFitPct,
      })
    : "";
  const fitNote = [fit.note, needsNote].filter(Boolean).join(" ");
  const verdict = executiveSummary({
    ready,
    pct: adjustedPct,
    giveCount: give.length,
    getCount: get.length,
    overflow: constraint.overflow,
    ...(isSandbox ? {} : { impact }),
    opponentImpact: isSandbox ? null : rivalImpact,
  });
  const balanceTilt = valueOnly ? valueTilt : (valueTilt + adjustedPct) / 2;

  const toAsset = (p: Player): BulletAsset => ({
    name: p.name,
    pos: String(p.pos ?? ""),
    value: Math.max(0, brain?.[p.id]?.value ?? 0),
    trend: brain?.[p.id]?.trend ?? 0,
    injuryStatus: resolveInjuryStatus(p, brain) ?? "Healthy",
    weekly: weeklyOf(p),
  });
  const giveAssets = give.map(toAsset);
  const getAssets = get.map(toAsset);
  const benchDelta =
    getAssets.reduce((s, a) => s + a.weekly, 0) -
    giveAssets.reduce((s, a) => s + a.weekly, 0) -
    constraint.penalty -
    impact.delta;
  const giveBullets = sideBullets({ side: "give", assets: giveAssets });
  const getBullets = sideBullets({
    side: "get",
    assets: getAssets,
    impact: valueOnly ? null : impact,
    benchDelta: valueOnly ? null : benchDelta,
    dropSlots: benchSlotsRequired,
  });
  const depthRows = positionalDepth(giveAssets, getAssets);
  const risk = injuryRisk(giveAssets, getAssets);

  const swapTeams = () => {
    const lk = leftKey;
    setLeftKey(rightKey);
    setRightKey(lk);
    setGiveIds(getIds);
    setGetIds(giveIds);
    setExtraGive(extraGet);
    setExtraGet(extraGive);
  };

  return (
    <div className="w-full">
      <div>
        <h1 className="display-title text-3xl text-slate-900">
          Trade <span className="text-primary">Analyzer</span>
        </h1>
        <ActiveLeagueLabel className="mt-2 inline-block" />
      </div>

      {/* Search / team pickers sit on the page background; roster cards are separate. */}
      <section className="mt-4">
        <div className={cn(ANALYZER_SPLIT, "sm:items-start")}>
          <div className="space-y-2">
            <SidePlayerSearch
              value={leftSearchQ}
              onChange={setLeftSearchQ}
              results={leftSearchResults}
              onPick={addToGive}
              placeholder="Search players to trade away…"
              seasonPosRankFor={seasonPosRankFor}
            />
            <TeamHeader
              team={leftTeam}
              teams={allTeams.filter((t) => t.key !== rightKey)}
              needsByKey={needsByKey}
              recordBySlot={recordBySlot}
              onSelect={(key) => {
                setLeftKey(key);
                clearGive();
              }}
            />
          </div>

          <div className="flex items-end justify-center pb-1 sm:self-end sm:pb-2.5">
            <button
              type="button"
              onClick={swapTeams}
              className="rounded-full p-2 text-slate-500 transition-colors hover:bg-white/80 hover:text-slate-800"
              aria-label="Swap teams"
            >
              <ArrowLeftRight className="size-5" />
            </button>
          </div>

          <div className="space-y-2">
            <SidePlayerSearch
              value={rightSearchQ}
              onChange={setRightSearchQ}
              results={rightSearchResults}
              onPick={addToGet}
              placeholder="Search players to trade for…"
              seasonPosRankFor={seasonPosRankFor}
            />
            <TeamHeader
              team={rightTeam}
              teams={allTeams.filter((t) => t.key !== leftKey)}
              needsByKey={needsByKey}
              recordBySlot={recordBySlot}
              onSelect={(key) => {
                setRightKey(key);
                clearGet();
              }}
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <RosterPanel
              label="Trade away"
              players={sortPlayersByPos(mergeExtras(leftTeam?.players ?? [], extraGive))}
              selectedIds={new Set(give.map((p) => p.id))}
              onToggle={toggleGive}
              onClear={clearGive}
              onOpen={(id) => modalRef.current?.open(id)}
              brain={brain}
              seasonPosRankFor={seasonPosRankFor}
            />
            <PowerCard
              team={leftTeam}
              power={leftDisplayPower}
              delta={leftDelta}
              needs={leftNeeds}
              incoming={get}
              tone="left"
            />
          </div>

          {/* Open center gap between roster cards (swap control sits above with the dropdowns). */}
          <div className="hidden sm:block" aria-hidden />

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <RosterPanel
              label="Trade for"
              players={sortPlayersByPos(mergeExtras(rightTeam?.players ?? [], extraGet))}
              selectedIds={new Set(get.map((p) => p.id))}
              onToggle={toggleGet}
              onClear={clearGet}
              onOpen={(id) => modalRef.current?.open(id)}
              brain={brain}
              seasonPosRankFor={seasonPosRankFor}
            />
            <PowerCard
              team={rightTeam}
              power={rightDisplayPower}
              delta={rightDelta}
              needs={rightNeeds}
              incoming={give}
              tone="right"
            />
          </div>
        </div>
      </section>

      {ready ? (
        <>
          <AnalyzerResults
            tilt={balanceTilt}
            giveValue={giveValue}
            getValue={getValue}
            giveWeekly={giveWeekly}
            getWeekly={getWeekly}
            fitPct={fit.pct}
            gradeParts={valueOnly ? null : blended.parts}
            valueOnly={valueOnly}
            gradeLetter={adjustedGrade.letter}
            gradeTone={adjustedGrade.tone}
            headline={headlineVerdict({ ready, pct: adjustedPct })}
            verdict={verdict}
            fitNote={fitNote}
            giveBullets={giveBullets}
            getBullets={getBullets}
            depth={depthRows}
            risk={risk}
            showRosterRow={!valueOnly && userRoster.length > 0}
            dropSlots={benchSlotsRequired}
          />
          <TradeSideCompare
            give={give}
            get={get}
            scoring={valueScoring}
            valueBasis={valueBasis}
            detailsById={details.map}
            loading={details.loading}
            seasonPosRankFor={seasonPosRankFor}
          />
        </>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
          Select players on both sides to unlock the trade grade and breakdown.
        </div>
      )}

      <TradeSideCompare
        give={give}
        get={get}
        scoring={valueScoring}
        valueBasis={valueBasis}
        detailsById={details.map}
        loading={details.loading}
        seasonPosRankFor={seasonPosRankFor}
      />

      <PlayerModalHost ref={modalRef} />
    </div>
  );
}

function mergeExtras(roster: Player[], extras: Player[]): Player[] {
  const ids = new Set(roster.map((p) => p.id));
  return [...extras.filter((p) => !ids.has(p.id)), ...roster];
}

function SidePlayerSearch({
  value,
  onChange,
  results,
  onPick,
  placeholder,
  seasonPosRankFor,
}: {
  value: string;
  onChange: (v: string) => void;
  results: Player[];
  onPick: (p: Player) => void;
  placeholder: string;
  seasonPosRankFor: (playerId: string) => number | null;
}) {
  return (
    <div className="relative mb-2">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-sm outline-none focus:border-blue-600 focus:bg-white"
      />
      {results.length > 0 && (
        <ul className="absolute left-0 right-0 z-40 mt-1 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPick(p)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <PositionBadge
                  pos={p.pos === "DEF" ? "DST" : p.pos}
                  className="h-5 min-w-[2rem] text-[10px]"
                />
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                <span className="text-xs text-slate-500">{p.team || "FA"}</span>
                <span className="tabnum text-xs text-slate-400">
                  {posRankLabel(p, seasonPosRankFor(p.id))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TeamHeader({
  team,
  teams,
  needsByKey,
  recordBySlot,
  onSelect,
}: {
  team: AnalyzerTeam | null;
  teams: AnalyzerTeam[];
  needsByKey: Map<string, string[]>;
  recordBySlot: Map<number, string>;
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg border bg-white px-3 py-2.5 text-left transition-colors",
          open
            ? "border-blue-500 ring-1 ring-blue-500/30"
            : "border-slate-200 hover:border-slate-300",
        )}
      >
        {team?.logo ? (
          <img src={team.logo} alt="" className="size-8 shrink-0 rounded-md object-cover" />
        ) : (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-bold text-slate-600">
            {(team?.name ?? "TM").slice(0, 2).toUpperCase()}
          </div>
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">
          {team?.name ?? "Select team"}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-slate-400 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-30"
            aria-label="Close"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white shadow-xl sm:min-w-[22rem]">
            <div className="sticky top-0 grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-slate-100 bg-white px-3 py-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Team
              </span>
              <span className="text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Needs
              </span>
            </div>
            <ul>
              {teams.map((t) => {
                const needs = needsByKey.get(t.key) ?? [];
                const record = recordBySlot.get(t.slot);
                return (
                  <li key={t.key}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(t.key);
                        setOpen(false);
                      }}
                      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        {t.logo ? (
                          <img
                            src={t.logo}
                            alt=""
                            className="size-7 shrink-0 rounded-md object-cover"
                          />
                        ) : (
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[10px] font-bold text-slate-600">
                            {t.name.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-slate-900">
                            {t.name}
                          </span>
                          {record ? (
                            <span className="tabnum text-[11px] text-slate-500">{record}</span>
                          ) : null}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center justify-end gap-1">
                        {needs.length ? (
                          needs.map((pos) => (
                            <PositionBadge
                              key={pos}
                              pos={pos}
                              className="h-5 min-w-[1.85rem] text-[9px]"
                            />
                          ))
                        ) : (
                          <span className="text-[11px] text-slate-300">—</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function RosterPanel({
  label,
  players,
  selectedIds,
  onToggle,
  onClear,
  onOpen,
  brain,
  seasonPosRankFor,
}: {
  label: string;
  players: Player[];
  selectedIds: Set<string>;
  onToggle: (p: Player) => void;
  onClear: () => void;
  onOpen: (id: string) => void;
  brain: ReturnType<typeof usePlayerBrain>;
  seasonPosRankFor: (playerId: string) => number | null;
}) {
  return (
    <div className="flex min-h-[22rem] flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <button
          type="button"
          onClick={onClear}
          className="text-xs font-semibold text-blue-700 hover:underline disabled:text-slate-300"
          disabled={selectedIds.size === 0}
        >
          Clear
        </button>
        <span className="font-display text-[11px] font-bold uppercase tracking-widest text-slate-500">
          {label}
        </span>
        <span className="w-16 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Pos Rank
        </span>
      </div>
      <ul className="max-h-[28rem] flex-1 overflow-y-auto">
        {players.length === 0 ? (
          <li className="px-3 py-8 text-center text-sm text-slate-400">
            No players on this roster.
          </li>
        ) : (
          players.map((p) => {
            const checked = selectedIds.has(p.id);
            const injury = injuryMicroBadge(resolveInjuryStatus(p, brain));
            const displayPos = p.pos === "DEF" ? "DST" : p.pos;
            return (
              <li
                key={p.id}
                className={cn(
                  "flex items-center gap-2 border-b border-slate-50 px-3 py-2",
                  checked && "bg-blue-50/60",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(p)}
                  className="size-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  aria-label={`Select ${p.name}`}
                />
                <PositionBadge pos={displayPos} className="h-5 min-w-[2rem] shrink-0 text-[10px]" />
                <button
                  type="button"
                  onClick={() => onOpen(p.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <PlayerAvatar
                    id={p.id}
                    pos={p.pos}
                    team={p.team}
                    name={p.name}
                    className="size-8 shrink-0"
                    logoClassName="size-3.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-slate-900">
                        {p.name}
                      </span>
                      {injury && (
                        <span
                          className={cn(
                            "inline-flex h-4 min-w-4 items-center justify-center rounded px-0.5 text-[9px] font-bold text-white",
                            injury.className,
                          )}
                        >
                          {injury.label}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[11px] text-slate-500">
                      {p.team || "FA"}
                      {p.bye ? ` (${p.bye})` : ""}
                    </span>
                  </span>
                </button>
                <span className="w-16 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-600">
                  {posRankLabel(p, seasonPosRankFor(p.id))}
                </span>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

function PowerCard({
  team,
  power,
  delta,
  needs,
  incoming,
  tone,
}: {
  team: AnalyzerTeam | null;
  power: number | null;
  delta: number | null;
  needs: string[];
  incoming: Player[];
  tone: "left" | "right";
}) {
  const marker = powerMeterPct(power);
  const fillClass = tone === "left" ? "bg-slate-800" : "bg-slate-700";
  const dotClass = tone === "left" ? "bg-slate-900" : "bg-slate-800";
  return (
    <div className="border-t border-slate-100 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        {team?.logo ? (
          <img src={team.logo} alt="" className="size-7 rounded-full object-cover" />
        ) : (
          <div className="flex size-7 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">
            {(team?.name ?? "TM").slice(0, 2).toUpperCase()}
          </div>
        )}
        <span className="truncate text-sm font-bold text-slate-900">{team?.name ?? "—"}</span>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-display text-4xl font-bold tabular-nums leading-none text-slate-900">
          {power != null ? power.toFixed(1) : "—"}
        </span>
        {delta != null && delta !== 0 && (
          <span
            className={cn(
              "font-display text-lg font-bold tabular-nums",
              delta > 0 ? "text-emerald-600" : "text-rose-600",
            )}
          >
            {delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Power Rank
      </p>

      <div className="relative mt-4 h-2 w-full rounded-full bg-slate-200">
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-all duration-500",
            fillClass,
          )}
          style={{ width: `${marker}%` }}
        />
        <div
          className={cn(
            "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white transition-all duration-500",
            dotClass,
          )}
          style={{ left: `${marker}%` }}
        />
      </div>

      {incoming.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {incoming.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1"
            >
              <PlayerAvatar
                id={p.id}
                pos={p.pos}
                team={p.team}
                name={p.name}
                className="size-6"
                logoClassName="size-3"
              />
              <span className="text-[11px] font-semibold text-slate-700">{shortName(p.name)}</span>
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <BarChart3 className="size-3.5 text-slate-400" aria-hidden />
        <span className="text-xs font-semibold text-slate-500">Top Needs:</span>
        {needs.length ? (
          needs.map((pos) => (
            <PositionBadge key={pos} pos={pos} className="h-5 min-w-[1.9rem] text-[10px]" />
          ))
        ) : (
          <span className="text-xs text-slate-400">—</span>
        )}
      </div>
    </div>
  );
}

const FAIR_ZONE = 7;

function AnalyzerResults({
  tilt,
  giveValue,
  getValue,
  giveWeekly,
  getWeekly,
  fitPct,
  gradeParts,
  valueOnly,
  gradeLetter,
  gradeTone,
  headline,
  verdict,
  fitNote,
  giveBullets,
  getBullets,
  depth,
  risk,
  showRosterRow,
  dropSlots,
}: {
  tilt: number;
  giveValue: number;
  getValue: number;
  giveWeekly: number;
  getWeekly: number;
  fitPct: number;
  gradeParts: AnalyzerGradeParts | null;
  valueOnly: boolean;
  gradeLetter: string;
  gradeTone: string;
  headline: string;
  verdict: string;
  fitNote: string;
  giveBullets: Bullet[];
  getBullets: Bullet[];
  depth: PositionalDepthRow[];
  risk: InjuryRisk;
  showRosterRow: boolean;
  dropSlots: number;
}) {
  const clamped = Math.max(-100, Math.min(100, tilt));
  const mag = Math.abs(clamped);
  const zone = mag <= FAIR_ZONE ? "fair" : mag <= 18 ? "warn" : "unfair";
  const left = 50 + clamped / 2;
  const barTone =
    zone === "fair" ? "bg-emerald-500" : zone === "warn" ? "bg-amber-500" : "bg-destructive";
  const textTone =
    zone === "fair" ? "text-emerald-600" : zone === "warn" ? "text-amber-600" : "text-destructive";
  const haloTone =
    gradeTone === "good"
      ? "border-emerald-500/70 shadow-[0_0_18px_-2px_rgba(16,185,129,0.55)]"
      : gradeTone === "bad"
        ? "border-destructive/70 shadow-[0_0_18px_-2px_rgba(220,38,38,0.45)]"
        : "border-border";
  const giveScaled = scaleValue(giveValue);
  const getScaled = scaleValue(getValue);
  const gap = Math.round((getScaled - giveScaled) * 10) / 10;

  return (
    <div className="mt-4 space-y-3 duration-300 animate-in fade-in slide-in-from-top-2">
      <div className={ANALYZER_SPLIT}>
        <section className={cn("rounded-xl border-2 bg-card p-4 shadow-sm", haloTone)}>
          <div className="flex items-start gap-4">
            <div
              className={cn(
                "flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border-2 font-display text-3xl font-bold",
                gradeTone === "good"
                  ? "border-emerald-600 text-emerald-600"
                  : gradeTone === "bad"
                    ? "border-destructive text-destructive"
                    : "border-border text-foreground",
              )}
            >
              {gradeLetter}
            </div>
            <div className="min-w-0 flex-1">
              <p className="eyebrow">Overall Assessment</p>
              <div className="flex flex-wrap items-center gap-2">
                <p
                  className={cn(
                    "font-display text-xl font-bold leading-tight tracking-tight",
                    gradeTone === "good"
                      ? "text-emerald-600"
                      : gradeTone === "bad"
                        ? "text-destructive"
                        : "text-foreground",
                  )}
                >
                  {headline}
                </p>
                {dropSlots > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-600/40 bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">
                    {benchSlotWarning(dropSlots)}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm leading-snug text-foreground">{verdict}</p>
              {!valueOnly && <p className="mt-1 text-xs text-muted-foreground">{fitNote}</p>}
            </div>
          </div>
        </section>

        <div className="hidden sm:block" aria-hidden />

        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-baseline justify-between">
            <p className="eyebrow">Value Gap</p>
            <span className={cn("font-display text-xl font-bold tabnum", textTone)}>
              {gap === 0
                ? "Even"
                : `${gap > 0 ? "Value Premium: +" : "Value Deficit: "}${gap.toFixed(1)}`}
            </span>
          </div>
          <div className="relative mt-4 flex h-4 items-center justify-between text-[11px] uppercase tracking-widest text-muted-foreground">
            <span>You give</span>
            <span
              className={cn(
                "absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-display font-bold tracking-wider",
                textTone,
              )}
            >
              {zone === "fair" ? "Fair zone" : clamped > 0 ? "Tilts to you" : "Tilts to them"}
            </span>
            <span>You receive</span>
          </div>
          <div className="relative mt-3 h-3 w-full overflow-hidden rounded-full border border-border bg-surface">
            <div
              className={cn(
                "absolute inset-y-0 left-1/2 w-[14%] -translate-x-1/2 rounded-full transition-colors duration-300",
                zone === "fair"
                  ? "bg-emerald-500/25"
                  : zone === "warn"
                    ? "bg-amber-500/20"
                    : "bg-destructive/15",
              )}
            />
            <div
              className={cn(
                "absolute top-1/2 h-5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-500 ease-out",
                barTone,
              )}
              style={{ left: `${left}%` }}
            />
          </div>
          <div className="relative mt-2 flex h-5 items-center justify-between text-xs text-muted-foreground">
            <span className="tabnum">{giveScaled > 0 ? giveScaled.toFixed(1) : "—"}</span>
            <span
              className={cn(
                "absolute left-1/2 -translate-x-1/2 tabnum text-sm font-bold",
                textTone,
              )}
            >
              {`${clamped > 0 ? "+" : ""}${clamped.toFixed(1)}%`}
            </span>
            <span className="tabnum">{getScaled > 0 ? getScaled.toFixed(1) : "—"}</span>
          </div>
          {showRosterRow && (
            <div className="mt-3 space-y-3 border-t border-border pt-3 text-[11px] text-muted-foreground">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <b className="tabnum block text-sm text-foreground">{giveWeekly.toFixed(2)}</b>
                  Give pts/wk
                </div>
                <div>
                  <b className="tabnum block text-sm text-foreground">{getWeekly.toFixed(2)}</b>
                  Get pts/wk
                </div>
                <div>
                  <b
                    className={cn(
                      "tabnum block text-sm",
                      fitPct > 0
                        ? "text-emerald-600"
                        : fitPct < 0
                          ? "text-destructive"
                          : "text-foreground",
                    )}
                  >
                    {fitPct > 0 ? "+" : ""}
                    {fitPct}%
                  </b>
                  Lineup fit
                </div>
              </div>
              {gradeParts ? (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <b
                      className={cn(
                        "tabnum block text-sm",
                        gradeParts.power > 0
                          ? "text-emerald-600"
                          : gradeParts.power < 0
                            ? "text-destructive"
                            : "text-foreground",
                      )}
                    >
                      {gradeParts.power > 0 ? "+" : ""}
                      {gradeParts.power.toFixed(1)}%
                    </b>
                    Power
                  </div>
                  <div>
                    <b
                      className={cn(
                        "tabnum block text-sm",
                        gradeParts.lineup > 0
                          ? "text-emerald-600"
                          : gradeParts.lineup < 0
                            ? "text-destructive"
                            : "text-foreground",
                      )}
                    >
                      {gradeParts.lineup > 0 ? "+" : ""}
                      {gradeParts.lineup}%
                    </b>
                    Lineup
                  </div>
                  <div>
                    <b
                      className={cn(
                        "tabnum block text-sm",
                        gradeParts.needFit > 0
                          ? "text-emerald-600"
                          : gradeParts.needFit < 0
                            ? "text-destructive"
                            : "text-foreground",
                      )}
                    >
                      {gradeParts.needFit > 0 ? "+" : ""}
                      {gradeParts.needFit}%
                    </b>
                    Need fit
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>

      <div className={ANALYZER_SPLIT}>
        <BulletCard title="Giving Pros & Cons" bullets={giveBullets} />
        <div className="hidden sm:block" aria-hidden />
        <BulletCard title="Getting Pros & Cons" bullets={getBullets} />
      </div>

      {showRosterRow && (
        <div className={ANALYZER_SPLIT}>
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="eyebrow">Positional Depth</p>
            <div className="mt-3 flex flex-col gap-2">
              {depth.length ? (
                depth.map((d) => (
                  <span
                    key={d.pos}
                    className={cn(
                      "tabnum rounded-md border px-2.5 py-1.5 text-xs font-semibold",
                      d.delta > 0
                        ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-600"
                        : "border-destructive/40 bg-destructive/10 text-destructive",
                    )}
                  >
                    {d.pos}: {d.delta > 0 ? "+" : ""}
                    {d.delta.toFixed(1)} Value {d.delta > 0 ? "Gained" : "Lost"}
                  </span>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">
                  No positional value shift on this deal.
                </span>
              )}
            </div>
          </section>
          <div className="hidden sm:block" aria-hidden />
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="eyebrow">Injury Vulnerability</p>
            <div className="mt-3 flex flex-col items-center text-center">
              <span
                className={cn(
                  "inline-block rounded-md border px-3 py-1.5 font-display text-xs font-bold tracking-wide",
                  risk.level === "INCREASED"
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : risk.level === "REDUCED"
                      ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-600"
                      : "border-border bg-surface text-muted-foreground",
                )}
              >
                INJURY RISK: {risk.level}
              </span>
              <p className="mt-3 max-w-sm text-xs leading-relaxed text-muted-foreground">
                {risk.note}
              </p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function BulletCard({ title, bullets }: { title: string; bullets: Bullet[] }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="eyebrow">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {bullets.map((b, i) => (
          <li
            key={`${b.tone}-${i}`}
            className={cn(
              "flex gap-2 rounded-md px-1 py-0.5 text-xs leading-snug -mx-1",
              b.tone === "critical" && "bg-destructive/10",
            )}
          >
            <span
              className={cn(
                "mt-px font-bold",
                b.tone === "pro" ? "text-emerald-600" : "text-destructive",
              )}
            >
              {b.tone === "pro" ? "+" : "−"}
            </span>
            <span
              className={cn(
                b.tone === "critical" ? "font-semibold text-destructive" : "text-foreground",
              )}
            >
              {b.text}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
