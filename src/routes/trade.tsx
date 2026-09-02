import { ActiveLeagueLabel } from "@/components/league/ActiveLeagueLabel";
import { SyncLock } from "@/components/league/SyncLock";
import { AuthDialog } from "@/components/auth/AuthDialog";
import { useAuth } from "@/hooks/useAuth";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { queryOptions, useQueries, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { PlayerPicker } from "@/components/league/PlayerPicker";
import { PositionBadge } from "@/components/draft/PositionBadge";
import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { rosterSize, teamName, type Player, type Scoring } from "@/lib/draft";
import { buildSandboxTeams, injuryMicroBadge, resolveInjuryStatus } from "@/lib/sandbox-rosters";
import { grade } from "@/lib/evaluate";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import type { BrainMatrix } from "@/lib/playerBrainHydration";
import {
  executiveSummary,
  headlineVerdict,
  injuryRisk,
  opponentImpact as computeOpponentImpact,
  packageScore,
  positionalDepth,
  rosterConstraint,
  rosterFit,
  scaleValue,
  sideBullets,
  type Bullet,
  type BulletAsset,
  type InjuryRisk,
  type PositionalDepthRow,
  type RosterConstraint,
} from "@/lib/trade-engine";

import { getPlayerDetail, getPlayers } from "@/lib/players.functions";
import type { PlayerDetail } from "@/lib/players.server";
import { cn } from "@/lib/utils";
import { useDraft } from "@/hooks/use-draft";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";


const playersQuery = queryOptions({
  queryKey: ["players"],
  queryFn: () => getPlayers(),
  staleTime: 1000 * 60 * 30,
});

const detailQuery = (id: string) =>
  queryOptions({
    queryKey: ["player-detail", id],
    queryFn: () => getPlayerDetail({ data: { id } }),
    staleTime: 1000 * 60 * 30,
  });

export const Route = createFileRoute("/trade")({
  head: () => ({
    meta: [
      { title: "Trade Analyzer — The League Office" },
      {
        name: "description",
        content:
          "Analyze fantasy football trades with last season's stats, this year's projections, weekly averages and roster-need adjustments.",
      },
      { property: "og:title", content: "Trade Analyzer — The League Office" },
      {
        property: "og:description",
        content: "Side-by-side prior-year stats and projections for every trade you consider.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => {
    void context.queryClient.ensureQueryData(playersQuery);
  },
  component: TradeRoute,
});

const WEEKS = 17;

type Metrics = {
  player: Player;
  projTotal: number;
  projPerWk: number;
  prevTotal: number;
  prevGames: number;
  prevPerGame: number;
  posRank: number | null;
  prevSeason: string | null;
  line: { label: string; value: string }[];
  weekly: number;
};

const LOWER_IS_BETTER = new Set(["Pts allowed"]);

function metricsFor(player: Player, detail: PlayerDetail | undefined, scoring: Scoring): Metrics {
  const prevLine = detail?.history?.[0] ?? null;
  const projTotal = detail?.projection?.points?.[scoring] ?? player.proj?.[scoring] ?? 0;
  const prevTotal = prevLine?.points?.[scoring] ?? player.prev?.[scoring] ?? 0;
  const prevGames = prevLine?.games ?? 0;
  const prevPerGame = prevGames > 0 ? prevTotal / prevGames : 0;
  const projPerWk = projTotal / WEEKS;
  return {
    player,
    projTotal,
    projPerWk,
    prevTotal,
    prevGames,
    prevPerGame,
    posRank: prevLine?.posRank ?? null,
    prevSeason: prevLine?.season ?? null,
    line: prevLine?.line ?? [],
    weekly: projPerWk * 0.65 + prevPerGame * 0.35,
  };
}

type MarketLine = { bits: string[]; trend: string | null; up: boolean };

/**
 * Site-standard trade asset card: headshot overlaid on the team's graphical
 * branding wash, name on top, colored position tag tucked directly beneath it,
 * and cached market value / 30-day trend on the right rail.
 */
function TradeAssetCard({
  player,
  value,
  trendPct,
}: {
  player: Player;
  value: number | null;
  trendPct: number | null;
}) {
  const logo = teamLogo(player.team);
  return (
    <span className="relative flex min-w-0 items-center gap-2.5 overflow-hidden rounded-md">
      {logo && (
        <img
          src={logo}
          alt=""
          aria-hidden
          loading="lazy"
          className="pointer-events-none absolute -left-2 top-1/2 size-14 -translate-y-1/2 opacity-[0.14] blur-[0.2px]"
        />
      )}
      <span className="relative z-10 shrink-0">
        <PlayerAvatar
          id={player.id}
          pos={player.pos}
          team={player.team}
          name={player.name}
          className="size-10"
          logoClassName="size-4"
        />
      </span>
      <span className="relative z-10 min-w-0 flex-1">
        <span className="block truncate text-sm font-bold leading-tight text-foreground">
          {player.name}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          <PositionBadge pos={player.pos} className="h-4 min-w-[2rem] text-[9px]" />
          <span className="truncate text-[11px] leading-tight text-muted-foreground">
            {[player.team || "FA", player.bye ? `BYE ${player.bye}` : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      </span>
      <span className="relative z-10 shrink-0 pr-1 text-right">
        <span className="tabnum block text-sm font-semibold leading-tight text-foreground">
          {value ? scaleValue(value).toFixed(1) : "—"}
        </span>
        <span
          className={cn(
            "tabnum block text-[10px] leading-tight",
            !trendPct
              ? "text-muted-foreground"
              : trendPct > 0
                ? "text-emerald-600"
                : "text-destructive",
          )}
        >
          {trendPct ? `${trendPct > 0 ? "▲" : "▼"} ${Math.abs(trendPct).toFixed(1)}%` : "flat"}
        </span>
      </span>
    </span>
  );
}

/** Placeholder row appended when the receiving package needs an extra slot. */
function BenchDropPlaceholder({ count }: { count: number }) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-dashed border-border bg-surface/60 px-2 py-2.5 text-sm">
      <span className="grid h-6 min-w-[2.4rem] place-items-center rounded border border-neutral-400/60 bg-neutral-400 px-1.5 font-display text-xs font-semibold uppercase tracking-wider text-white">
        BN
      </span>
      <span className="truncate text-xs font-semibold text-muted-foreground">
        +{count} Bench Slot{count > 1 ? "s" : ""} Required
      </span>
    </li>
  );
}


type OpponentTeam = { key: string; name: string; owner: string; players: Player[] };

/** Light-themed ghost-state mask for the roster sidebars when no league is synced. */
function SidebarLock({
  authenticated,
  children,
}: {
  authenticated: boolean;
  onSignIn?: () => void;
  children: ReactNode;
}) {
  return <SyncLock authenticated={authenticated}>{children}</SyncLock>;
}



function TradeRoute() {
  const { activeLeagueId } = useActiveLeague();
  return <TradePage key={activeLeagueId ?? "none"} />;
}


function TradePage() {
  const { data } = useSuspenseQuery(playersQuery);
  const { activeLeague, sandboxMode } = useActiveLeague();
  const { user, ready: authReady } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const draft = useDraft();
  /** Cached market analytics (value + 30-day trend) from the local brain matrix. */
  const brain = usePlayerBrain();
  const marketLine = (p: Player) => {
    const entry = brain?.[p.id] ?? null;
    const bits = [p.pos, p.team || "FA", p.bye ? `BYE ${p.bye}` : null].filter(Boolean) as string[];
    if (entry?.value) bits.push(`Value: ${entry.value.toLocaleString()}`);
    const pct =
      entry?.value && entry?.trend ? (entry.trend / Math.abs(entry.value)) * 100 : 0;
    const trend = pct ? `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%` : null;
    return { bits, trend, up: pct > 0 };
  };


  const [give, setGive] = useState<Player[]>([]);
  const [get, setGet] = useState<Player[]>([]);
  const [tab, setTab] = useState<"overview" | "stats">("overview");
  const scoring = draft.settings.scoring;

  const selected = useMemo(() => [...give, ...get], [give, get]);
  const details = useQueries({
    queries: selected.map((p) => detailQuery(p.id)),
    combine: (results) => {
      const map = new Map<string, PlayerDetail>();
      results.forEach((r, i) => {
        const id = selected[i]?.id;
        if (id && r.data) map.set(id, r.data);
      });
      return { map, loading: results.some((r) => r.isLoading) };
    },
  });

  const giveRows = useMemo(
    () => give.map((p) => metricsFor(p, details.map.get(p.id), scoring)),
    [give, details.map, scoring],
  );
  const getRows = useMemo(
    () => get.map((p) => metricsFor(p, details.map.get(p.id), scoring)),
    [get, details.map, scoring],
  );

  /**
   * Sidebars unlock for sandbox mode so mock rosters render freely, but stay
   * locked behind the sync overlay for unsigned-out / unlinked live users.
   */
  const locked = !sandboxMode && (!authReady || !user || !activeLeague?.id);


  const byId = useMemo(() => new Map(data.players.map((p) => [p.id, p])), [data.players]);
  const league = useLeagueRosters(data.players);
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

  /** Roster priority in Sandbox Mode: live War Room / Mock Draft state first
   *  (same draft store the draft pages persist to), falling back to the shared
   *  demo catalog teams only when no draft has ever been run. */
  const hasDraftPicks = draft.picks.length > 0;
  const sandboxTeams = useMemo(
    () => (sandboxMode && !hasDraftPicks ? buildSandboxTeams(data.players) : null),
    [sandboxMode, hasDraftPicks, data.players],
  );
  const roster = useMemo(() => {
    if (sandboxMode) {
      if (hasDraftPicks) return rostersByTeam.get(draft.settings.myTeam) ?? [];
      return sandboxTeams?.myTeam ?? [];
    }
    if (league?.synced && league?.myTeam) return league.myTeam.players;
    return rostersByTeam.get(draft.settings.myTeam) ?? [];
  }, [
    sandboxMode,
    hasDraftPicks,
    sandboxTeams,
    league?.synced,
    league?.myTeam,
    rostersByTeam,
    draft.settings.myTeam,
  ]);

  const myTeamLabel = sandboxMode
    ? "My Team"
    : (league?.synced ? (league?.myTeam?.team ?? league?.myTeamName) : null) ??
      teamName(draft.settings, draft.settings.myTeam);

  const otherTeams = useMemo(() => {
    if (sandboxMode) {
      if (sandboxTeams) return sandboxTeams.rivalTeams;
      // Live draft state: every other War Room draft slot becomes a rival roster.
      return [...rostersByTeam.keys()]
        .filter((t) => t !== draft.settings.myTeam)
        .sort((a, b) => a - b)
        .map((t) => ({
          key: `t${t}`,
          name: teamName(draft.settings, t),
          owner: "",
          players: rostersByTeam.get(t) ?? [],
        }));
    }
    if (league?.synced) {
      return league.teams
        .filter((t) => !t.isMine)
        .map((t) => ({ key: `s${t.slot}`, name: t.team, owner: t.owner, players: t.players }));
    }
    return [...rostersByTeam.keys()]
      .filter((t) => t !== draft.settings.myTeam)
      .sort((a, b) => a - b)
      .map((t) => ({
        key: `t${t}`,
        name: teamName(draft.settings, t),
        owner: "",
        players: rostersByTeam.get(t) ?? [],
      }));
  }, [sandboxMode, sandboxTeams, league?.synced, league?.teams, rostersByTeam, draft.settings]);



  /**
   * Flush the sidebar templates and re-seed them from the active league the
   * moment the global selection (or its resolved rosters) changes.
   */
  const [userRoster, setUserRoster] = useState<Player[]>([]);
  const [leagueTeams, setLeagueTeams] = useState<OpponentTeam[]>([]);
  const [opponentRosters, setOpponentRosters] = useState<Record<string, Player[]>>({});

  useEffect(() => {
    setUserRoster([]);
    setLeagueTeams([]);
    setOpponentRosters({});
  }, [activeLeague?.id]);

  useEffect(() => {
    setUserRoster(roster);
    setLeagueTeams(otherTeams);
    setOpponentRosters(Object.fromEntries(otherTeams.map((t) => [t.key, t.players])));
  }, [roster, otherTeams]);




  /** Data-driven roster fit: positional scarcity before vs. after the deal. */
  const fit = useMemo(
    () =>
      rosterFit({
        roster: userRoster.map((p) => ({ pos: p.pos, weekly: (p.proj?.[scoring] ?? 0) / WEEKS })),
        give: give.map((p) => ({ pos: p.pos, weekly: (p.proj?.[scoring] ?? 0) / WEEKS })),
        get: get.map((p) => ({ pos: p.pos, weekly: (p.proj?.[scoring] ?? 0) / WEEKS })),
        starters: draft.settings.roster as unknown as Record<string, number>,
      }),
    [userRoster, give, get, scoring, draft.settings.roster],
  );
  const needDelta = fit.pct;


  /**
   * Asymmetric packages: the side sending more bodies takes a consolidation
   * discount, so a 2-for-1 must clear a higher bar than a straight swap.
   */
  const giveWeekly = packageScore(
    giveRows.map((r) => r.weekly),
    getRows.length,
  );
  const rawGetWeekly = packageScore(
    getRows.map((r) => r.weekly),
    giveRows.length,
  );

  /** Bench vacancy check: receiving more players than you send can force a drop. */
  const rosterCap = rosterSize(draft.settings.roster);
  const benchPool = useMemo(
    () =>
      userRoster
        .filter((p) => !give.some((g) => g.id === p.id))
        .concat(get)
        .map((p) => ({
          name: p.name,
          pos: p.pos,
          weekly: (p.proj?.[scoring] ?? 0) / WEEKS,
        })),
    [userRoster, give, get, scoring],
  );
  const constraint = rosterConstraint({
    rosterCount: userRoster.length,
    rosterCap,
    giveCount: give.length,
    getCount: get.length,
    bench: benchPool,
    starters: draft.settings.roster as unknown as Record<string, number>,
  });


  const getWeekly = Math.max(0, rawGetWeekly - constraint.penalty);
  const basePct = ((getWeekly - giveWeekly) / Math.max(giveWeekly, getWeekly, 0.01)) * 100;
  const impact = fit.impact;

  /**
   * Two-sided fairness. The rival roster is the opposing team that owns the
   * incoming players; the same lineup optimizer runs on their pool with the
   * packages reversed.
   */
  const rivalRoster = useMemo(() => {
    if (!get.length) return null;
    const owner = leagueTeams.find((t) =>
      (opponentRosters[t.key] ?? t.players).some((p) => get.some((g) => g.id === p.id)),
    );
    return owner ? (opponentRosters[owner.key] ?? owner.players) : null;
  }, [get, leagueTeams, opponentRosters]);

  const rivalImpact = useMemo(() => {
    if (!rivalRoster || !rivalRoster.length || !give.length || !get.length) return null;
    return computeOpponentImpact({
      roster: rivalRoster.map((p) => ({ pos: p.pos, weekly: (p.proj?.[scoring] ?? 0) / WEEKS })),
      give: give.map((p) => ({ pos: p.pos, weekly: (p.proj?.[scoring] ?? 0) / WEEKS })),
      get: get.map((p) => ({ pos: p.pos, weekly: (p.proj?.[scoring] ?? 0) / WEEKS })),
      starters: draft.settings.roster as unknown as Record<string, number>,
    });
  }, [rivalRoster, give, get, scoring, draft.settings.roster]);
  /**
   * Marginal lineup reality overrules package-size dilution: a real upgrade to
   * the optimized starting lineup cannot be graded below the deal's true
   * weekly impact just because it costs bench bodies.
   */
  const isSandbox = sandboxMode || !league?.synced;

  /** Sandbox / unsynced desks show asset value only — no lineup telemetry. */
  const valueOnly = isSandbox;
  const marketValue = (list: Player[]) =>
    list.reduce((s2, p) => s2 + Math.max(0, brain?.[p.id]?.value ?? 0), 0);
  const giveValue = marketValue(give);
  const getValue = marketValue(get);
  const valueTilt =
    giveValue + getValue > 0
      ? ((getValue - giveValue) / Math.max(giveValue, getValue, 1)) * 100
      : ((getWeekly - giveWeekly) / Math.max(giveWeekly, getWeekly, 0.01)) * 100;

  // Direction is always relative to the user's gain: receive − give.
  // In sandbox the market-value tilt IS the grade; live desks blend in roster fit.
  let adjustedPct = isSandbox ? valueTilt : basePct + needDelta;

  if (!isSandbox && impact.delta > 0.25) adjustedPct = Math.max(adjustedPct, needDelta);
  if (!isSandbox && impact.delta > 2) adjustedPct = Math.max(adjustedPct, 15);

  const adjustedGrade = grade(adjustedPct);
  const ready = give.length > 0 && get.length > 0;
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



  const sum = (rows: Metrics[], key: keyof Metrics) =>
    rows.reduce((s, r) => s + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);

  const statsSeason =
    giveRows.find((r) => r.prevSeason)?.prevSeason ??
    getRows.find((r) => r.prevSeason)?.prevSeason ??
    "Last";

  const overviewRows: CompareRow[] = [
    buildRow("Season Total (proj)", sum(giveRows, "projTotal"), sum(getRows, "projTotal")),
    buildRow("Season Avg. (proj)", sum(giveRows, "projPerWk"), sum(getRows, "projPerWk")),
    buildRow(`${statsSeason} Total`, sum(giveRows, "prevTotal"), sum(getRows, "prevTotal")),
    buildRow(`${statsSeason} Avg.`, sum(giveRows, "prevPerGame"), sum(getRows, "prevPerGame")),
    buildRow("Games Played", sum(giveRows, "prevGames"), sum(getRows, "prevGames"), { digits: 0 }),
  ];

  const bestRank = (rows: Metrics[]) => {
    const ranks = rows.map((r) => r.posRank).filter((n): n is number => Boolean(n));
    return ranks.length ? Math.min(...ranks) : null;
  };
  const lineTotal = (rows: Metrics[], label: string) => {
    const vals = rows
      .flatMap((r) => r.line.filter((l) => l.label === label).map((l) => Number(l.value)))
      .filter((n) => Number.isFinite(n));
    return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
  };
  const labels: string[] = [];
  for (const r of [...giveRows, ...getRows])
    for (const l of r.line) if (!labels.includes(l.label)) labels.push(l.label);

  const statRows: CompareRow[] = [
    buildRow("Position Rank", bestRank(giveRows), bestRank(getRows), {
      lowerBetter: true,
      digits: 0,
      prefix: "#",
    }),
    buildRow("Fantasy Pts", sum(giveRows, "prevTotal"), sum(getRows, "prevTotal")),
    buildRow("Fantasy Pts / Game", sum(giveRows, "prevPerGame"), sum(getRows, "prevPerGame")),
    ...labels.map((label) =>
      buildRow(label, lineTotal(giveRows, label), lineTotal(getRows, label), {
        lowerBetter: LOWER_IS_BETTER.has(label),
      }),
    ),
  ];

  /* ---------- Modular dashboard analytics ---------- */

  const toAsset = (p: Player): BulletAsset => ({
    name: p.name,
    pos: String(p.pos ?? ""),
    value: Math.max(0, brain?.[p.id]?.value ?? 0),
    trend: brain?.[p.id]?.trend ?? 0,
    injuryStatus: resolveInjuryStatus(p, brain) ?? "Healthy",
    weekly: (p.proj?.[scoring] ?? 0) / WEEKS,
  });

  const giveAssets = give.map(toAsset);
  const getAssets = get.map(toAsset);

  /** Bench differential = total roster weekly swing minus the starting swing. */
  const benchDelta =
    getAssets.reduce((s, a) => s + a.weekly, 0) -
    giveAssets.reduce((s, a) => s + a.weekly, 0) -
    impact.delta;

  const giveBullets = sideBullets({ side: "give", assets: giveAssets });
  const getBullets = sideBullets({
    side: "get",
    assets: getAssets,
    impact: valueOnly ? null : impact,
    benchDelta: valueOnly ? null : benchDelta,
  });
  const depthRows = positionalDepth(giveAssets, getAssets);
  const risk = injuryRisk(giveAssets, getAssets);


  return (
    <div className="mx-auto grid w-full max-w-[100rem] gap-4 px-3 pb-16 pt-6 xl:grid-cols-[16rem_minmax(0,1fr)_18rem]">
      {locked ? (
        <SidebarLock authenticated={Boolean(user)} onSignIn={() => setAuthOpen(true)}>
          <RosterColumn
            title="My team"
            subtitle="—"
            players={[]}
            selectedIds={new Set()}
            onPick={() => {}}
          />
        </SidebarLock>
      ) : (
        <RosterColumn
          title="My team"
          subtitle={myTeamLabel}
          players={userRoster}
          selectedIds={new Set(give.map((p) => p.id))}
          onPick={(p) => setGive((s) => (s.some((x) => x.id === p.id) ? s : [...s, p]))}
          brain={brain}
        />
      )}

      <main className="min-w-0">

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display-title text-4xl">
            Trade <span className="text-primary">Analyzer</span>
          </h1>
          <ActiveLeagueLabel className="mt-2 inline-block" />
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          Scoring: <b className="text-foreground">{scoring}</b> · Team:{" "}
          <b className="text-foreground">{draft.settings.myTeam}</b>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <PlayerPicker
          label="You give"
          players={data.players}
          selected={give}
          onAdd={(p) => setGive((s) => [...s, p])}
          onRemove={(id) => setGive((s) => s.filter((p) => p.id !== id))}
          renderMeta={(p) => <MarketRow player={p} line={marketLine(p)} />}
        />
        <PlayerPicker
          label="You receive"
          accent="get"
          players={data.players}
          selected={get}
          onAdd={(p) => setGet((s) => [...s, p])}
          onRemove={(id) => setGet((s) => s.filter((p) => p.id !== id))}
          renderMeta={(p) => <MarketRow player={p} line={marketLine(p)} />}
        />
      </div>

      <TradeDashboard
        ready={ready}
        tilt={balanceTilt}
        giveValue={giveValue}
        getValue={getValue}
        giveWeekly={giveWeekly}
        getWeekly={getWeekly}
        fitPct={needDelta}
        valueOnly={valueOnly}
        gradeLetter={ready ? adjustedGrade.letter : "—"}
        gradeTone={adjustedGrade.tone}
        headline={headlineVerdict({ ready, pct: adjustedPct })}
        verdict={verdict}
        fitNote={fit.note}
        giveBullets={giveBullets}
        getBullets={getBullets}
        depth={depthRows}
        risk={risk}
        showRosterRow={ready && !valueOnly && userRoster.length > 0}
        constraint={constraint}
      />


      <div className="mt-4 flex gap-1">
        {(
          [
            ["overview", "Overview"],
            ["stats", "Stats"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex-1 rounded-md border px-3 py-1.5 font-display text-sm uppercase tracking-wide transition-colors",
              tab === key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {details.loading && (
        <p className="mt-3 text-center text-xs text-muted-foreground">Loading player stats…</p>
      )}

      <section className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 p-3">
          <SideHead rows={giveRows} title="You give" />
          <span className="self-center rounded-full border border-border bg-surface px-2 py-1 font-display text-[10px] uppercase tracking-widest text-muted-foreground">
            vs
          </span>
          <SideHead rows={getRows} title="You receive" align="right" />
        </div>

        {!ready ? (
          <p className="border-t border-border p-4 text-center text-xs text-muted-foreground">
            Add at least one player to each side to compare.
          </p>
        ) : tab === "overview" ? (
          <CompareTable title="Fantasy Points" rows={overviewRows} />
        ) : (
          <CompareTable title={`${statsSeason} Season Stats`} rows={statRows} />
        )}
      </section>

      <p className="mt-3 text-center text-[11px] text-muted-foreground">
        Green numbers hold the statistical advantage. Grades blend this year's projections (65%)
        with last season's per-game production (35%), apply a consolidation discount to the wider
        package, then adjust for open roster slots configured in the War Room.
      </p>
      </main>

      {locked ? (
        <SidebarLock authenticated={Boolean(user)} onSignIn={() => setAuthOpen(true)}>
          <OtherTeamsColumn teams={[]} selectedIds={new Set()} onPick={() => {}} />
        </SidebarLock>
      ) : (
        <OtherTeamsColumn
          teams={leagueTeams.map((t) => ({ ...t, players: opponentRosters[t.key] ?? t.players }))}
          selectedIds={new Set(get.map((p) => p.id))}
          onPick={(p) => setGet((s) => (s.some((x) => x.id === p.id) ? s : [...s, p]))}
          brain={brain}
        />
      )}

      <AuthDialog open={authOpen} mode="signin" onOpenChange={setAuthOpen} />
    </div>

  );

}

function better(a: number, b: number) {
  return a > b && Math.abs(a - b) > 0.05;
}

type CompareRow = {
  label: string;
  give: string;
  get: string;
  giveWin: boolean;
  getWin: boolean;
};

function buildRow(
  label: string,
  a: number | null,
  b: number | null,
  opts: { lowerBetter?: boolean; digits?: number; prefix?: string } = {},
): CompareRow {
  const digits = opts.digits ?? 1;
  const fmt = (v: number | null) =>
    v === null || !Number.isFinite(v) ? "—" : `${opts.prefix ?? ""}${v.toFixed(digits)}`;
  const valid = a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b);
  const aWins = valid && (opts.lowerBetter ? better(b!, a!) : better(a!, b!));
  const bWins = valid && (opts.lowerBetter ? better(a!, b!) : better(b!, a!));
  return { label, give: fmt(a), get: fmt(b), giveWin: aWins, getWin: bWins };
}

function CompareTable({ title, rows }: { title: string; rows: CompareRow[] }) {
  if (!rows.length)
    return (
      <p className="border-t border-border p-4 text-center text-xs text-muted-foreground">
        No stats available for these players.
      </p>
    );
  return (
    <table className="w-full border-t border-border text-sm">
      <thead>
        <tr className="bg-surface">
          <th
            colSpan={3}
            className="px-3 py-2 text-center font-display text-[11px] uppercase tracking-widest text-muted-foreground"
          >
            {title}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-t border-border">
            <td
              className={cn(
                "w-1/3 px-3 py-2 text-left text-base tabular-nums",
                r.giveWin ? "font-bold text-emerald-600" : "font-semibold text-foreground",
              )}
            >
              {r.give}
            </td>
            <td className="px-2 py-2 text-center text-[11px] uppercase tracking-wide text-muted-foreground">
              {r.label}
            </td>
            <td
              className={cn(
                "w-1/3 px-3 py-2 text-right text-base tabular-nums",
                r.getWin ? "font-bold text-emerald-600" : "font-semibold text-foreground",
              )}
            >
              {r.get}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SideHead({
  rows,
  title,
  align,
}: {
  rows: Metrics[];
  title: string;
  align?: "right";
}) {
  return (
    <div className={cn("min-w-0", align === "right" && "text-right")}>
      <p className="eyebrow">{title}</p>
      {!rows.length && <p className="mt-1 text-xs text-muted-foreground">No players.</p>}
      <div className="mt-1 space-y-1.5">
        {rows.map((m) => (
          <div
            key={m.player.id}
            className={cn(
              "flex items-center gap-2",
              align === "right" && "flex-row-reverse text-right",
            )}
          >
            <PositionBadge pos={m.player.pos} className="h-5 shrink-0 text-[10px]" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">{m.player.name}</p>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {m.player.pos} · {m.player.team}
                {m.player.bye ? ` · Bye ${m.player.bye}` : ""}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}



function RosterRow({
  player,
  selected,
  onPick,
  brain,
}: {
  player: Player;
  selected: boolean;
  onPick: (p: Player) => void;
  brain?: BrainMatrix | null | undefined;
}) {
  const badge = injuryMicroBadge(resolveInjuryStatus(player, brain));
  const meta = [player.pos, player.team || null, player.bye ? `BYE ${player.bye}` : null].filter(
    Boolean,
  ) as string[];
  return (
    <button
      type="button"
      disabled={selected}
      onClick={() => onPick(player)}
      className={cn(
        "group relative flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors",
        selected
          ? "cursor-default opacity-50"
          : "hover:border-border hover:bg-surface focus-visible:border-border",
      )}
    >
      <PlayerAvatar
        id={player.id}
        pos={player.pos}
        team={player.team}
        name={player.name}
        className="size-9"
        logoClassName="size-3.5"
      />
      <span className="min-w-0 flex-1 pr-12">
        <span className="block truncate text-sm font-bold leading-tight text-black">
          {player.name}
        </span>
        <span className="flex items-center gap-1.5 truncate whitespace-nowrap text-[11px] leading-tight text-muted-foreground">
          {badge && (
            <span
              className={cn(
                "grid h-5 w-5 shrink-0 place-items-center rounded-[2px] text-[10px] font-bold text-white",
                badge.className,
              )}
            >
              {badge.label}
            </span>
          )}
          <span className="truncate">{meta.join(" · ")}</span>
        </span>
      </span>
      <span
        aria-hidden
        className={cn(
          "absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded border border-input bg-secondary/40 text-sm font-semibold transition-colors",
          selected
            ? "bg-muted text-muted-foreground"
            : "text-black group-hover:bg-primary group-hover:text-primary-foreground",
        )}
      >
        {selected ? "✓" : "+"}
      </span>
    </button>
  );
}

function RosterColumn({
  title,
  subtitle,
  players,
  selectedIds,
  onPick,
  brain,
}: {
  title: string;
  subtitle: string;
  players: Player[];
  selectedIds: Set<string>;
  onPick: (p: Player) => void;
  brain?: BrainMatrix | null | undefined;
}) {
  return (
    <aside className="min-w-0 rounded-xl border border-border bg-card p-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
      <p className="eyebrow">{title}</p>
      <p className="truncate text-sm font-semibold">{subtitle}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
        Tap to add to “You give”
      </p>
      {players.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No players yet — draft or sync a league in the War Room.
        </p>
      ) : (
        <div className="mt-2 space-y-0.5">
          {players.map((p) => (
            <RosterRow key={p.id} player={p} selected={selectedIds.has(p.id)} onPick={onPick} brain={brain} />
          ))}
        </div>
      )}
    </aside>
  );
}

function OtherTeamsColumn({
  teams,
  selectedIds,
  onPick,
  brain,
}: {
  teams: { key: string; name: string; owner: string; players: Player[] }[];
  selectedIds: Set<string>;
  onPick: (p: Player) => void;
  brain?: BrainMatrix | null | undefined;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [focusedTeamId, setFocusedTeamId] = useState<string | null>(null);

  const focusedTeam = focusedTeamId ? teams.find((t) => t.key === focusedTeamId) : null;

  return (
    <aside className="min-w-0 rounded-xl border border-border bg-card p-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
      {focusedTeam ? (
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => {
              setFocusedTeamId(null);
              setOpenKey(null);
            }}
            className="pb-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            ◄ Back to All Teams
          </button>
          <div
            className="cursor-pointer rounded-md border border-border bg-surface p-2"
            onClick={() => {
              setFocusedTeamId(null);
              setOpenKey(null);
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium">{focusedTeam.name}</span>
              <span className="tabnum shrink-0 text-[10px] text-muted-foreground">
                {focusedTeam.players.length}
              </span>
            </div>
            {focusedTeam.owner && (
              <span className="block truncate text-[10px] uppercase tracking-widest text-muted-foreground">
                {focusedTeam.owner}
              </span>
            )}
          </div>
          <div className="space-y-0.5 pt-1">
            {focusedTeam.players.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">No players rostered.</p>
            ) : (
              focusedTeam.players.map((p) => (
                <RosterRow
                  key={p.id}
                  player={p}
                  selected={selectedIds.has(p.id)}
                  onPick={onPick}
                  brain={brain}
                />
              ))
            )}
          </div>
        </div>
      ) : (
        <>
          <p className="eyebrow">League rosters</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
            Tap to add to “You receive”
          </p>
          <div className="mt-2 space-y-1">
            {teams.length === 0 && (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                No opposing teams yet — sync a league to load rosters.
              </p>
            )}
            {teams.map((t) => {
              const players = t.players;
              return (
                <details
                  key={t.key}
                  open={openKey === t.key}
                  className="rounded-md border border-border bg-surface"
                >
                  <summary
                    className="flex cursor-pointer items-center justify-between gap-2 px-2 py-1.5 text-sm font-medium"
                    onClick={(e) => {
                      e.preventDefault();
                      setOpenKey((k) => (k === t.key ? null : t.key));
                      setFocusedTeamId(t.key);
                    }}
                  >
                    <span className="min-w-0 truncate">
                      <span className="block truncate">{t.name}</span>
                      {t.owner && (
                        <span className="block truncate text-[10px] uppercase tracking-widest text-muted-foreground">
                          {t.owner}
                        </span>
                      )}
                    </span>
                    <span className="tabnum shrink-0 text-[10px] text-muted-foreground">
                      {players.length}
                    </span>
                  </summary>
                  <div className="space-y-0.5 border-t border-border p-1">
                    {players.length === 0 ? (
                      <p className="px-2 py-1.5 text-xs text-muted-foreground">No players rostered.</p>
                    ) : (
                      players.map((p) => (
                        <RosterRow
                          key={p.id}
                          player={p}
                          selected={selectedIds.has(p.id)}
                          onPick={onPick}
                          brain={brain}
                        />
                      ))
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </>
      )}
    </aside>
  );
}

/** Fair-value variance window, in percent, that counts as an even deal. */
const FAIR_ZONE = 7;

/**
 * Center console tug-of-war meter. The marker slides toward whichever side
 * the deal favors; the middle band glows green inside the fair-value window
 * and shifts to amber, then red, as the imbalance widens.
 */
function TradeDashboard({
  ready,
  tilt,
  giveValue,
  getValue,
  giveWeekly,
  getWeekly,
  fitPct,
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
  constraint,
}: {
  ready: boolean;
  tilt: number;
  giveValue: number;
  getValue: number;
  giveWeekly: number;
  getWeekly: number;
  fitPct: number;
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
  constraint: RosterConstraint;
}) {
  const clamped = Math.max(-100, Math.min(100, ready ? tilt : 0));
  const mag = Math.abs(clamped);
  const zone = mag <= FAIR_ZONE ? "fair" : mag <= 18 ? "warn" : "unfair";
  // Needle physically slides toward the heavier side of the deal.
  const left = 50 + clamped / 2;
  const barTone =
    zone === "fair" ? "bg-emerald-500" : zone === "warn" ? "bg-amber-500" : "bg-destructive";
  const textTone =
    zone === "fair" ? "text-emerald-600" : zone === "warn" ? "text-amber-600" : "text-destructive";

  const giveScaled = scaleValue(giveValue);
  const getScaled = scaleValue(getValue);
  const gap = Math.round((getScaled - giveScaled) * 10) / 10;

  return (
    <div className="mt-4 space-y-3">
      {/* ---------- Top analytical row ---------- */}
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start gap-4">
            <div
              className={cn(
                "flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border-2 font-display text-3xl font-bold",
                !ready
                  ? "border-border text-muted-foreground"
                  : gradeTone === "good"
                    ? "border-emerald-600 text-emerald-600"
                    : gradeTone === "bad"
                      ? "border-destructive text-destructive"
                      : "border-border text-foreground",
              )}
            >
              {gradeLetter}
            </div>
            <div className="min-w-0 flex-1">
              <p className="eyebrow">Overall assessment</p>
              <p
                className={cn(
                  "font-display text-xl font-bold leading-tight tracking-tight",
                  !ready
                    ? "text-muted-foreground"
                    : gradeTone === "good"
                      ? "text-emerald-600"
                      : gradeTone === "bad"
                        ? "text-destructive"
                        : "text-foreground",
                )}
              >
                {headline}
              </p>
              <p className="mt-1 text-sm leading-snug text-foreground">{verdict}</p>
              {ready && !valueOnly && (
                <p className="mt-1 text-xs text-muted-foreground">{fitNote}</p>
              )}
            </div>
          </div>
          {ready && constraint.overflow && (
            <p className="mt-3 rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground">
              ROSTER CONSTRAINT: Accepting this deal requires dropping {constraint.dropCount} bench
              player{constraint.dropCount > 1 ? "s" : ""}.
              {constraint.dropNames.length
                ? ` Model drops ${constraint.dropNames.join(", ")} and subtracts ${constraint.penalty.toFixed(1)} pts/wk from the receive side.`
                : ""}
            </p>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-baseline justify-between">
            <p className="eyebrow">Value gap</p>
            <span className={cn("font-display text-xl font-bold tabnum", textTone)}>
              {!ready
                ? "—"
                : gap === 0
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
              {!ready
                ? "Awaiting both sides"
                : zone === "fair"
                  ? "Fair zone"
                  : clamped > 0
                    ? "Tilts to you"
                    : "Tilts to them"}
            </span>
            <span>You receive</span>
          </div>

          <div className="relative mt-3 h-3 w-full overflow-hidden rounded-full border border-border bg-surface">
            <div
              className={cn(
                "absolute inset-y-0 left-1/2 w-[14%] -translate-x-1/2 rounded-full transition-colors duration-300",
                zone === "fair"
                  ? "bg-emerald-500/25 shadow-[0_0_14px_2px_rgba(16,185,129,0.55)]"
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
              className={cn("absolute left-1/2 -translate-x-1/2 tabnum text-sm font-bold", textTone)}
            >
              {ready ? `${clamped > 0 ? "+" : ""}${clamped.toFixed(1)}%` : "0.0%"}
            </span>
            <span className="tabnum">{getScaled > 0 ? getScaled.toFixed(1) : "—"}</span>
          </div>

          {showRosterRow && (
            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center text-[11px] text-muted-foreground">
              <div>
                <b className="tabnum block text-sm text-foreground">{giveWeekly.toFixed(1)}</b>
                Give pts/wk
              </div>
              <div>
                <b className="tabnum block text-sm text-foreground">{getWeekly.toFixed(1)}</b>
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
                Roster fit
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ---------- Middle analytical row ---------- */}
      <div className="grid gap-3 lg:grid-cols-2">
        <BulletCard title="Giving pros & cons" bullets={giveBullets} />
        <BulletCard title="Getting pros & cons" bullets={getBullets} />
      </div>

      {/* ---------- Bottom analytical row ---------- */}
      {showRosterRow && (
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="eyebrow">Positional depth & risk analysis</p>
          <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                Positional depth
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {depth.length ? (
                  depth.map((d) => (
                    <span
                      key={d.pos}
                      className={cn(
                        "tabnum rounded-md border px-2.5 py-1 text-xs font-semibold",
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
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                Injury vulnerability
              </p>
              <span
                className={cn(
                  "mt-2 inline-block rounded-md border px-2.5 py-1 font-display text-xs font-bold tracking-wide",
                  risk.level === "INCREASED"
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : risk.level === "REDUCED"
                      ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-600"
                      : "border-border bg-surface text-muted-foreground",
                )}
              >
                INJURY RISK: {risk.level}
              </span>
              <p className="mt-2 text-xs leading-snug text-muted-foreground">{risk.note}</p>
            </div>
          </div>
        </section>
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
          <li key={`${b.tone}-${i}`} className="flex gap-2 text-xs leading-snug">
            <span
              className={cn(
                "mt-px font-bold",
                b.tone === "pro" ? "text-emerald-600" : "text-destructive",
              )}
            >
              {b.tone === "pro" ? "+" : "−"}
            </span>
            <span className="text-foreground">{b.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
