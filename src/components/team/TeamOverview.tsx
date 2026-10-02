import { Link } from "@tanstack/react-router";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { playerImage } from "@/components/draft/PlayerAvatar";
import { MatchupPreviewCard, MatchupTeamAvatar } from "@/components/playbook/MatchupPreviewCard";
import { playbookPanelTitleClass } from "@/components/playbook/panels";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useActiveMatchups } from "@/hooks/useActiveMatchups";
import { useActiveStandings } from "@/hooks/useActiveStandings";
import { useLeagueAnalytics, useStartingSlotRanks } from "@/hooks/useLeagueAnalytics";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useNflGameProgress } from "@/hooks/useNflGameProgress";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Player } from "@/lib/draft";
import { computeMatchupPreview, matchupSlotLabels } from "@/lib/matchup-preview";
import { positionRoomRanks } from "@/lib/position-room-ranks";
import { cn } from "@/lib/utils";

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
const EDGE_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
type OffensePos = (typeof POSITIONS)[number];

const POS_FILL: Record<OffensePos, string> = {
  QB: "bg-qb/70",
  RB: "bg-rb/70",
  WR: "bg-wr/70",
  TE: "bg-te/70",
};
const POS_STROKE: Record<OffensePos, string> = {
  QB: "var(--color-qb)",
  RB: "var(--color-rb)",
  WR: "var(--color-wr)",
  TE: "var(--color-te)",
};
const POS_TEXT: Record<string, string> = {
  QB: "text-qb",
  RB: "text-rb",
  WR: "text-wr",
  TE: "text-te",
  K: "text-k",
  DEF: "text-def",
};
const SLOT_CHIP: Record<string, string> = {
  QB: "bg-qb/70 text-white border-qb/70",
  RB: "bg-rb/70 text-white border-rb/70",
  WR: "bg-wr/70 text-white border-wr/70",
  TE: "bg-te/70 text-white border-te/70",
  K: "bg-k/70 text-white border-k/70",
  DEF: "bg-def/70 text-white border-def/70",
};

const boxClass = "rounded-xl border border-border bg-card";
const labelClass = "text-[10px] font-bold uppercase tracking-wider text-slate-500";

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

function rankTone(rank: number | null, teams: number): string {
  if (rank == null || teams < 3) return "text-slate-900";
  if (rank <= Math.ceil(teams * 0.3)) return "text-emerald-600";
  if (rank > teams - Math.ceil(teams * 0.3)) return "text-rose-600";
  return "text-slate-900";
}

/** Standard normal CDF (Abramowitz–Stegun). */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/** Positions a seat label (QB1, RB2, FLEX, SFLEX, W/R, W/T) accepts. */
function seatEligible(label: string): string[] {
  if (label === "FLEX") return ["RB", "WR", "TE"];
  if (label.startsWith("SFLEX")) return ["QB", "RB", "WR", "TE"];
  if (label.startsWith("W/R")) return ["RB", "WR"];
  if (label.startsWith("W/T")) return ["WR", "TE"];
  if (label.startsWith("FLEX")) return ["RB", "WR", "TE"];
  return [label.replace(/\d+$/, "")];
}

function numberedSlots(labels: string[]): string[] {
  const totals = new Map<string, number>();
  for (const l of labels) totals.set(l, (totals.get(l) ?? 0) + 1);
  const seen = new Map<string, number>();
  return labels.map((l) => {
    const n = (seen.get(l) ?? 0) + 1;
    seen.set(l, n);
    return l === "FLEX" && (totals.get(l) ?? 0) === 1 ? "FLEX" : `${l}${n}`;
  });
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
}

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className={playbookPanelTitleClass}>{children}</h2>
      {action}
    </div>
  );
}

type Tone = "good" | "mid" | "bad";

const TONE_STYLES: Record<Tone, { text: string; bar: string; wash: string; seg: string }> = {
  good: {
    text: "text-emerald-600",
    bar: "bg-emerald-500",
    wash: "from-emerald-50/80",
    seg: "bg-emerald-500",
  },
  mid: { text: "text-blue-600", bar: "bg-blue-500", wash: "from-blue-50/70", seg: "bg-blue-500" },
  bad: { text: "text-rose-600", bar: "bg-rose-500", wash: "from-rose-50/80", seg: "bg-rose-500" },
};

function rankToneKey(rank: number | null, teams: number): Tone {
  if (rank == null || teams < 3) return "mid";
  if (rank <= Math.ceil(teams * 0.3)) return "good";
  if (rank > teams - Math.ceil(teams * 0.3)) return "bad";
  return "mid";
}

function StatCard({
  label,
  value,
  suffix,
  footer,
  tone = "mid",
  rank,
  teams,
  children,
}: {
  label: string;
  value: string;
  suffix?: string | undefined;
  footer: ReactNode;
  tone?: Tone;
  rank?: number | null;
  teams?: number;
  children?: ReactNode;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden rounded-xl border border-border bg-card bg-gradient-to-br via-card to-card px-5 pb-4 pt-5 shadow-sm transition-shadow hover:shadow-md",
        styles.wash,
      )}
    >
      <span className={cn("absolute inset-x-0 top-0 h-1", styles.bar)} />
      <p className={labelClass}>{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1.5">
        <span className={cn("text-3xl font-black tabular-nums tracking-tight", styles.text)}>
          {value}
        </span>
        {suffix ? <span className="text-sm font-semibold text-slate-400">{suffix}</span> : null}
      </p>
      {children ??
        (rank != null && teams ? (
          <div className="mt-3 flex gap-1" aria-hidden>
            {Array.from({ length: teams }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 flex-1 rounded-full",
                  i + 1 === rank ? styles.seg : "bg-slate-200/80",
                )}
              />
            ))}
          </div>
        ) : null)}
      <div className="mt-3 text-xs font-medium text-slate-500">{footer}</div>
    </div>
  );
}

function Headshot({ player, className }: { player: Player; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = playerImage(player.id, player.pos, player.team);
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100",
        className,
      )}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="text-[10px] font-bold text-slate-500">{player.pos}</span>
      )}
    </span>
  );
}

export function TeamOverview({
  rosterId,
  onOpenPlayer,
}: {
  rosterId: number;
  onOpenPlayer: (id: string) => void;
}) {
  const { activeLeague } = useActiveLeague();
  const { data: playersPayload } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const { teams, rosterPositions, loading: rostersLoading } = useLeagueRosters(players);
  const { standings } = useActiveStandings();
  const brain = usePlayerBrain();
  const league = useLeagueAnalytics({ history: true, forecast: true });
  const currentWeek = league.currentWeek;
  const slotRanks = useStartingSlotRanks(currentWeek);
  const { projectFor } = useLeagueProjections(currentWeek);
  const { matchups, loading: matchupsLoading } = useActiveMatchups(currentWeek);
  const { progressByNflTeam } = useNflGameProgress(currentWeek);
  const [valueView, setValueView] = useState<"all" | "starters">("all");
  const [byeWeekPick, setByeWeekPick] = useState<number | null>(null);

  const team = teams.find((t) => Number(t.slot) === Number(rosterId)) ?? null;
  const isMine = Boolean(team?.isMine);
  const platform = activeLeague?.platform ?? null;
  const leagueKey = activeLeague?.id ?? "none";
  const rows = standings?.rows ?? [];
  const teamCount = rows.length || teams.length;
  const standingIndex = rows.findIndex((r) => Number(r.rosterId) === Number(rosterId));
  const standing = standingIndex >= 0 ? rows[standingIndex]! : null;
  const stats = league.analytics?.get(rosterId) ?? null;
  const pfRank =
    stats?.pfRank ??
    (standing
      ? [...rows]
          .sort((a, b) => b.pointsFor - a.pointsFor)
          .findIndex((r) => r.rosterId === rosterId) + 1
      : null);
  const recordOf = (id: number) => {
    const r = rows.find((row) => Number(row.rosterId) === Number(id));
    if (!r) return null;
    return r.ties ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
  };
  const slotTeam = slotRanks.data?.teams.find((t) => t.rosterId === rosterId) ?? null;
  const ppgOf = (id: string) => slotTeam?.ppgById[id] ?? null;

  // Team value by position, ranked across the league.
  const valueBoard = useMemo(() => {
    const starterIdsFor = (id: number) =>
      new Set(
        (slotRanks.data?.teams.find((t) => t.rosterId === id)?.seats ?? [])
          .map((s) => s.playerId)
          .filter((x): x is string => Boolean(x)),
      );
    const byTeam = teams.map((t) => {
      const starters = starterIdsFor(t.slot);
      const totals: Record<OffensePos, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
      for (const p of t.players) {
        if (!(POSITIONS as readonly string[]).includes(p.pos)) continue;
        if (valueView === "starters" && !starters.has(p.id)) continue;
        const v = brain?.[p.id]?.value;
        if (typeof v === "number" && Number.isFinite(v) && v > 0) totals[p.pos as OffensePos] += v;
      }
      const total = POSITIONS.reduce((s, pos) => s + totals[pos], 0);
      return { slot: t.slot, totals, total };
    });
    const rankOf = (value: (row: (typeof byTeam)[number]) => number) => {
      const sorted = [...byTeam].sort((a, b) => value(b) - value(a));
      return new Map(sorted.map((row, i) => [row.slot, i + 1]));
    };
    const totalRank = rankOf((r) => r.total);
    const mine = byTeam.find((r) => r.slot === rosterId) ?? null;
    return { mine, totalRank: totalRank.get(rosterId) ?? null, teams: byTeam.length };
  }, [teams, brain, slotRanks.data, valueView, rosterId]);

  // League position ranks: projected points per game from each team's best lineup, same as Standings.
  const roomRanks = useMemo(() => positionRoomRanks(slotRanks.data?.teams ?? []), [slotRanks.data]);
  const rooms = useMemo(() => {
    const mine = roomRanks.ppg.get(rosterId);
    if (!mine) return [];
    return POSITIONS.map((pos) => ({
      pos,
      rank: roomRanks.ranks[pos].get(rosterId) ?? null,
      ppg: mine[pos],
      teams: roomRanks.teams,
    })).filter((r) => r.rank != null);
  }, [roomRanks, rosterId]);
  const weakest = rooms.length
    ? [...rooms].sort((a, b) => b.rank! - a.rank! || a.ppg - b.ppg)[0]!
    : null;
  const strongest = rooms.length
    ? [...rooms].sort((a, b) => a.rank! - b.rank! || b.ppg - a.ppg)[0]!
    : null;

  // This week's matchup — same math as the dashboard card and Matchup page.
  const matchup = useMemo(() => {
    const entries = matchups?.entries ?? [];
    const mine = entries.find((e) => Number(e.rosterId) === Number(rosterId)) ?? null;
    if (!mine) return null;
    const rival =
      mine.matchupId != null
        ? (entries.find(
            (e) =>
              e.matchupId != null &&
              Number(e.matchupId) === Number(mine.matchupId) &&
              Number(e.rosterId) !== Number(rosterId),
          ) ?? null)
        : null;
    if (!rival) return null;
    const oppTeam = teams.find((t) => Number(t.slot) === Number(rival.rosterId)) ?? null;
    const preview = computeMatchupPreview({
      mine: {
        team,
        points: mine.points,
        starterIds: mine.starters ?? [],
        starterNames: mine.starterNames ?? [],
        playerPoints: mine.playerPoints ?? {},
      },
      opp: {
        team: oppTeam,
        points: rival.points,
        starterIds: rival.starters ?? [],
        starterNames: rival.starterNames ?? [],
        playerPoints: rival.playerPoints ?? {},
      },
      rosterPositions,
      playersById,
      projectFor,
      progressByNflTeam,
      activeWeek: currentWeek ?? 1,
    });
    const week = currentWeek ?? 1;
    const projectedBy = (starters: Player[]) => {
      const out: Record<string, number> = {};
      for (const p of starters) {
        if (p.bye != null && Number(p.bye) === Number(week)) continue;
        out[p.pos] = (out[p.pos] ?? 0) + (projectFor(p.id) ?? 0);
      }
      return out;
    };
    const mineBy = projectedBy(preview.mineStarters);
    const oppBy = projectedBy(preview.oppStarters);
    const edges = EDGE_POSITIONS.filter((pos) => mineBy[pos] != null || oppBy[pos] != null).map(
      (pos) => ({
        pos,
        mine: mineBy[pos] ?? 0,
        opp: oppBy[pos] ?? 0,
      }),
    );
    return {
      ...preview,
      edges,
      myLive: mine.points,
      oppLive: rival.points,
      oppRosterId: Number(rival.rosterId),
      oppName: oppTeam?.team || rival.teamName || "Opponent",
      oppLogo: oppTeam?.logo || rival.logo || null,
    };
  }, [
    matchups,
    rosterId,
    teams,
    team,
    rosterPositions,
    playersById,
    projectFor,
    progressByNflTeam,
    currentWeek,
  ]);

  // Season schedule: results so far, then projected scores and win odds.
  const schedule = useMemo(() => {
    const sdDiff = (stats?.weeklySd ?? 25) * Math.SQRT2;
    const weeks: {
      week: number;
      oppId: number | null;
      result: "W" | "L" | "T" | null;
      score: string | null;
      winPct: number | null;
    }[] = [];
    const pairFor = (entries: { rosterId: number; matchupId: number | null; points: number }[]) => {
      const mine = entries.find((e) => Number(e.rosterId) === Number(rosterId));
      if (!mine || mine.matchupId == null) return null;
      const opp = entries.find(
        (e) =>
          e.matchupId != null &&
          Number(e.matchupId) === Number(mine.matchupId) &&
          Number(e.rosterId) !== Number(rosterId),
      );
      return opp ? { mine, opp } : null;
    };
    league.completedWeekNumbers.forEach((week, i) => {
      const pair = pairFor(league.historyQueries[i]?.data?.entries ?? []);
      if (!pair) {
        weeks.push({ week, oppId: null, result: null, score: null, winPct: null });
        return;
      }
      const a = Number(pair.mine.points) || 0;
      const b = Number(pair.opp.points) || 0;
      weeks.push({
        week,
        oppId: Number(pair.opp.rosterId),
        result: Math.abs(a - b) < 0.005 ? "T" : a > b ? "W" : "L",
        score: `${a.toFixed(1)}-${b.toFixed(1)}`,
        winPct: null,
      });
    });
    league.remainingWeekNumbers.forEach((week, i) => {
      const pair = pairFor(league.scheduleQueries[i]?.data?.entries ?? []);
      if (!pair) {
        weeks.push({ week, oppId: null, result: null, score: null, winPct: null });
        return;
      }
      const oppId = Number(pair.opp.rosterId);
      if (week === currentWeek && matchup && matchup.oppRosterId === oppId) {
        weeks.push({
          week,
          oppId,
          result: null,
          score: `${Math.round(matchup.myOrigProj)}-${Math.round(matchup.oppOrigProj)}`,
          winPct: matchup.myWinPct,
        });
        return;
      }
      const idx = league.rosProjections?.weeks.indexOf(week) ?? -1;
      const byRoster = idx >= 0 ? league.rosProjections?.byWeek[idx] : undefined;
      const a = byRoster?.[String(rosterId)];
      const b = byRoster?.[String(oppId)];
      weeks.push({
        week,
        oppId,
        result: null,
        score: a != null && b != null ? `${Math.round(a)}-${Math.round(b)}` : null,
        winPct: a != null && b != null ? Math.round(normalCdf((a - b) / sdDiff) * 100) : null,
      });
    });
    return weeks;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query stamps track fetch completion
  }, [
    league.historyStamp,
    league.scheduleQueries,
    league.rosProjections,
    rosterId,
    currentWeek,
    matchup,
    stats?.weeklySd,
  ]);

  // Bye weeks: starters (best lineup by projected points per game) who sit, and who steps in.
  const byePlan = useMemo(() => {
    if (!slotTeam || !team || currentWeek == null) return [];
    const seats = slotTeam.seats
      .map((s) => ({ ...s, player: s.playerId ? (playersById.get(s.playerId) ?? null) : null }))
      .filter((s): s is typeof s & { player: Player } => Boolean(s.player));
    const starterIds = new Set(seats.map((s) => s.player.id));
    const bench = team.players
      .filter((p) => !starterIds.has(p.id) && (POSITIONS as readonly string[]).includes(p.pos))
      .map((p) => ({ player: p, ppg: slotTeam.ppgById[p.id] ?? 0 }))
      .filter((b) => b.ppg > 0)
      .sort((a, b) => b.ppg - a.ppg);
    const byeWeeks = [
      ...new Set(
        players
          .map((p) => p.bye)
          .filter((w): w is number => w != null && w >= currentWeek && w <= 17),
      ),
    ].sort((a, b) => a - b);
    return byeWeeks.map((week) => {
      const out = seats.filter((s) => s.player.bye === week);
      const available = bench.filter((b) => b.player.bye !== week);
      const used = new Set<string>();
      const swaps = out.map((seat) => {
        const sub =
          available.find(
            (b) => !used.has(b.player.id) && seatEligible(seat.label).includes(b.player.pos),
          ) ?? null;
        if (sub) used.add(sub.player.id);
        return { seat, sub, short: Math.max(0, seat.ppg - (sub?.ppg ?? 0)) };
      });
      const short = swaps.reduce((s, x) => s + x.short, 0);
      const status = !out.length
        ? "none"
        : short <= 3
          ? "covered"
          : short <= 8
            ? "moderate"
            : "thin";
      return { week, swaps, available, status } as const;
    });
  }, [slotTeam, team, players, playersById, currentWeek]);
  const selectedBye =
    byePlan.find((b) => b.week === byeWeekPick) ??
    byePlan.find((b) => b.swaps.length) ??
    byePlan[0] ??
    null;

  // Full roster in lineup order: host starters, then bench, then IR.
  const roster = useMemo(() => {
    if (!team) return [];
    const labels = numberedSlots(matchupSlotLabels(rosterPositions));
    const starters = labels.map((label, i) => ({ label, player: team.starters[i] ?? null }));
    const bench = team.bench.map((p) => ({ label: "BN", player: p as Player | null }));
    const ir = team.ir.map((p) => ({ label: "IR", player: p as Player | null }));
    return [...starters, ...bench, ...ir];
  }, [team, rosterPositions]);

  if (!team) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        {rostersLoading ? "Loading team overview…" : "This team isn't in the active league."}
      </p>
    );
  }

  const record = standing ? (recordOf(rosterId) ?? "0-0") : "—";
  const projectedRecord =
    stats?.projectedWins != null && stats.projectedGames != null
      ? `${Math.round(stats.projectedWins)}-${Math.max(0, stats.projectedGames - Math.round(stats.projectedWins))}`
      : null;
  const scheduleRows = Math.max(1, Math.ceil(schedule.length / 9));
  const scheduleCols = Math.max(1, Math.ceil(schedule.length / scheduleRows));
  const scheduleOpen = scheduleRows * scheduleCols - schedule.length;
  const upcoming = schedule.filter(
    (w): w is (typeof schedule)[number] & { winPct: number } => !w.result && w.winPct != null,
  );
  const scheduleSummary =
    scheduleOpen > 0 && upcoming.length
      ? {
          span: scheduleOpen,
          games: upcoming.length,
          expectedWins: upcoming.reduce((s, w) => s + w.winPct / 100, 0),
          toughest: upcoming.reduce((a, b) => (b.winPct < a.winPct ? b : a)),
          easiest: upcoming.reduce((a, b) => (b.winPct > a.winPct ? b : a)),
        }
      : null;
  const form = schedule.filter((w) => w.result).slice(-5);
  const gamesPlayed = standing ? standing.wins + standing.losses + standing.ties : 0;
  const winRate = gamesPlayed ? (standing!.wins + standing!.ties / 2) / gamesPlayed : null;
  const recordTone: Tone =
    winRate == null ? "mid" : winRate >= 0.6 ? "good" : winRate <= 0.4 ? "bad" : "mid";
  const streak = standing?.streak ?? null;
  const recordFooter =
    currentWeek != null && currentWeek > 1
      ? `Through Week ${currentWeek - 1}${streak ? ` · ${streak} streak` : ""}`
      : "Season opener";
  const standingRank = standingIndex >= 0 ? standingIndex + 1 : null;
  const playoffCut = league.playoffTeamsSetting;
  const playoffLine = (() => {
    if (!standing || standingRank == null || !playoffCut || playoffCut >= rows.length) {
      return "By record";
    }
    const gamesBetween = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
      (a.wins - b.wins + (b.losses - a.losses)) / 2;
    if (standingRank <= playoffCut) {
      const firstOut = rows[playoffCut]!;
      const lead = gamesBetween(standing, firstOut);
      return lead > 0
        ? `In playoff position · ${lead.toFixed(1)} games up`
        : "In playoff position · tied at the line";
    }
    const lastIn = rows[playoffCut - 1]!;
    const back = gamesBetween(lastIn, standing);
    return back > 0
      ? `${back.toFixed(1)} games back of ${ordinal(playoffCut)}`
      : `Tied with ${ordinal(playoffCut)} for the last spot`;
  })();
  const pfVsAvg =
    standing && rows.length
      ? standing.pointsFor - rows.reduce((s, r) => s + r.pointsFor, 0) / rows.length
      : null;
  const efficiency =
    standing && stats?.maxPf ? Math.round((standing.pointsFor / stats.maxPf) * 100) : null;
  const valueTotal = valueBoard.mine?.total ?? 0;
  const pending = league.analyticsLoading ? "…" : "—";
  const pct = (v: number | null | undefined) => (v == null ? pending : `${Math.round(v)}%`);

  // Donut geometry
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Record" value={record} tone={recordTone} footer={recordFooter}>
          <div className="mt-3 flex h-6 items-center gap-1">
            {form.length ? (
              form.map((w) => (
                <span
                  key={w.week}
                  title={`Week ${w.week}: ${w.result}`}
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-black text-white",
                    w.result === "W"
                      ? "bg-emerald-500"
                      : w.result === "L"
                        ? "bg-rose-500"
                        : "bg-slate-400",
                  )}
                >
                  {w.result}
                </span>
              ))
            ) : (
              <span className="text-xs text-slate-400">No games played</span>
            )}
          </div>
        </StatCard>
        <StatCard
          label="Standing"
          value={standingRank ? ordinal(standingRank) : "—"}
          suffix={standingRank ? `of ${teamCount}` : undefined}
          tone={rankToneKey(standingRank, teamCount)}
          rank={standingRank}
          teams={teamCount}
          footer={playoffLine}
        />
        <StatCard
          label="Points For"
          value={pfRank ? ordinal(pfRank) : "—"}
          suffix={pfRank ? `of ${teamCount}` : undefined}
          tone={rankToneKey(pfRank, teamCount)}
          rank={pfRank}
          teams={teamCount}
          footer={
            standing ? (
              <>
                <span className="font-bold text-slate-700 tabular-nums">
                  {standing.pointsFor.toFixed(1)}
                </span>{" "}
                pts
                {pfVsAvg != null ? (
                  <span
                    className={cn(
                      "ml-1.5 font-semibold tabular-nums",
                      pfVsAvg >= 0 ? "text-emerald-600" : "text-rose-600",
                    )}
                  >
                    {pfVsAvg >= 0 ? "+" : "−"}
                    {Math.abs(pfVsAvg).toFixed(1)} vs avg
                  </span>
                ) : null}
              </>
            ) : (
              "—"
            )
          }
        />
        <StatCard
          label="Max PF"
          value={stats?.maxPfRank ? ordinal(stats.maxPfRank) : pending}
          suffix={stats?.maxPfRank ? `of ${teamCount}` : undefined}
          tone={rankToneKey(stats?.maxPfRank ?? null, teamCount)}
          rank={stats?.maxPfRank ?? null}
          teams={teamCount}
          footer={
            stats?.maxPf != null ? (
              <>
                <span className="font-bold text-slate-700 tabular-nums">
                  {stats.maxPf.toFixed(1)}
                </span>{" "}
                pts
                {efficiency != null ? (
                  <span className="ml-1.5 font-semibold tabular-nums text-slate-600">
                    {efficiency}% lineup efficiency
                  </span>
                ) : null}
              </>
            ) : (
              "Best possible lineups"
            )
          }
        />
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-10">
          <section>
            <SectionTitle
              action={
                <div className="flex items-center gap-1.5">
                  {(["all", "starters"] as const).map((view) => (
                    <button
                      key={view}
                      type="button"
                      onClick={() => setValueView(view)}
                      className={
                        valueView === view
                          ? "cursor-pointer rounded-lg bg-slate-800 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-white"
                          : "cursor-pointer rounded-lg border border-slate-200/70 bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500 hover:bg-slate-200/80"
                      }
                    >
                      {view === "all" ? "All" : "Starters"}
                    </button>
                  ))}
                </div>
              }
            >
              Team Value
            </SectionTitle>
            <div className={cn(boxClass, "flex flex-col items-center gap-6 p-5 sm:flex-row")}>
              <div className="relative size-40 shrink-0">
                <svg viewBox="0 0 140 140" className="size-full -rotate-90">
                  <circle
                    cx="70"
                    cy="70"
                    r={radius}
                    fill="none"
                    stroke="#f1f5f9"
                    strokeWidth="16"
                  />
                  {valueTotal > 0
                    ? POSITIONS.map((pos) => {
                        const share = (valueBoard.mine?.totals[pos] ?? 0) / valueTotal;
                        const dash = share * circumference;
                        const el = (
                          <circle
                            key={pos}
                            cx="70"
                            cy="70"
                            r={radius}
                            fill="none"
                            stroke={POS_STROKE[pos]}
                            strokeOpacity={0.75}
                            strokeWidth="16"
                            strokeDasharray={`${Math.max(0, dash - 1.5)} ${circumference}`}
                            strokeDashoffset={-offset}
                          />
                        );
                        offset += dash;
                        return el;
                      })
                    : null}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-xl font-black tabular-nums text-slate-900">
                    {Math.round(valueTotal).toLocaleString()}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Total Value
                  </span>
                  {valueBoard.totalRank ? (
                    <span
                      className={cn(
                        "text-xs font-bold tabular-nums",
                        rankTone(valueBoard.totalRank, valueBoard.teams),
                      )}
                    >
                      #{valueBoard.totalRank} of {valueBoard.teams}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="w-full min-w-0 flex-1">
                <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_3rem_4.5rem_4rem] items-center gap-3 border-b border-slate-100 pb-2">
                  <span className={labelClass}>Pos</span>
                  <span />
                  <span className={cn(labelClass, "text-right")}>Share</span>
                  <span className={cn(labelClass, "text-right")}>Value</span>
                  <span className={cn(labelClass, "text-right")}>Lg Rank</span>
                </div>
                {[...POSITIONS]
                  .sort(
                    (a, b) => (valueBoard.mine?.totals[b] ?? 0) - (valueBoard.mine?.totals[a] ?? 0),
                  )
                  .map((pos) => {
                    const v = valueBoard.mine?.totals[pos] ?? 0;
                    const share = valueTotal > 0 ? (v / valueTotal) * 100 : 0;
                    const rank = roomRanks.ranks[pos].get(rosterId) ?? null;
                    return (
                      <div
                        key={pos}
                        className="grid grid-cols-[2.5rem_minmax(0,1fr)_3rem_4.5rem_4rem] items-center gap-3 border-b border-slate-100 py-2.5 last:border-b-0"
                      >
                        <span className={cn("text-xs font-black", POS_TEXT[pos])}>{pos}</span>
                        <span className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <span
                            className={cn("block h-full rounded-full", POS_FILL[pos])}
                            style={{ width: `${share}%` }}
                          />
                        </span>
                        <span className="text-right text-xs font-semibold tabular-nums text-slate-500">
                          {Math.round(share)}%
                        </span>
                        <span className="text-right text-sm font-bold tabular-nums text-slate-900">
                          {Math.round(v).toLocaleString()}
                        </span>
                        <span
                          className={cn(
                            "text-right text-sm font-bold tabular-nums",
                            rankTone(rank, roomRanks.teams),
                          )}
                          title={
                            rank
                              ? `${pos} room: ${(roomRanks.ppg.get(rosterId)?.[pos] ?? 0).toFixed(1)} projected points a week, #${rank} of ${roomRanks.teams}`
                              : undefined
                          }
                        >
                          {rank ? `#${rank}` : "—"}
                          <span className="text-xs font-medium text-slate-400">
                            /{roomRanks.teams || valueBoard.teams}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                <p className="pt-2 text-[11px] text-slate-400">
                  Value is trade value. Lg Rank is projected points a week from the best lineup, the same
                  ranking as Standings.
                </p>
              </div>
            </div>
          </section>

          <section>
            <SectionTitle
              action={
                isMine ? (
                  <Link
                    to="/playbook/matchup"
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    See Matchup
                  </Link>
                ) : null
              }
            >
              This Week's Matchup
            </SectionTitle>
            {matchup ? (
              <MatchupPreviewCard
                loading={matchupsLoading && !matchup}
                leagueId={leagueKey}
                platform={platform}
                myName={team.team}
                myLogo={team.logo}
                myRecord={recordOf(rosterId)}
                myLive={matchup.myLive}
                myProj={matchup.myOrigProj}
                myWinPct={matchup.myWinPct}
                oppName={matchup.oppName}
                oppLogo={matchup.oppLogo}
                oppRecord={recordOf(matchup.oppRosterId)}
                oppLive={matchup.oppLive}
                oppProj={matchup.oppOrigProj}
                oppWinPct={matchup.oppWinPct}
                weekStarted={matchup.weekStarted}
                matchupFinal={matchup.matchupFinal}
              />
            ) : null}
            {matchup && matchup.edges.length ? (
              <div className={cn(boxClass, "mt-3 px-4 py-3")}>
                <div className="mb-2 flex items-center justify-between">
                  <p className={labelClass}>Projected by position</p>
                  <p className="text-[10px] font-semibold text-slate-400">
                    Top {isMine ? "you" : "this team"}, bottom opponent
                  </p>
                </div>
                <div
                  className="grid gap-2"
                  style={{ gridTemplateColumns: `repeat(${matchup.edges.length}, minmax(0, 1fr))` }}
                >
                  {matchup.edges.map((e) => {
                    const diff = e.mine - e.opp;
                    const tone =
                      Math.abs(diff) < 0.5
                        ? "text-slate-900"
                        : diff > 0
                          ? "text-emerald-600"
                          : "text-rose-600";
                    return (
                      <div
                        key={e.pos}
                        className="flex flex-col items-center rounded-lg border border-slate-100 bg-slate-50/60 py-2"
                        title={`${e.pos}: ${e.mine.toFixed(1)} vs ${e.opp.toFixed(1)} projected`}
                      >
                        <span className={cn("text-[10px] font-black", POS_TEXT[e.pos])}>
                          {e.pos}
                        </span>
                        <span className={cn("text-sm font-black tabular-nums", tone)}>
                          {e.mine.toFixed(1)}
                        </span>
                        <span className="text-[11px] tabular-nums text-slate-400">
                          {e.opp.toFixed(1)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {matchup ? null : (
              <div className={cn(boxClass, "p-5 text-sm text-muted-foreground")}>
                {matchupsLoading ? "Loading matchup…" : "No matchup this week."}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-10">
          <section>
            <SectionTitle>Recommendation</SectionTitle>
            <div className={cn(boxClass, "space-y-4 p-5")}>
              {weakest && weakest.rank != null ? (
                <div>
                  <p className="text-base font-bold text-slate-900">
                    {weakest.rank > Math.ceil(weakest.teams / 2)
                      ? isMine
                        ? `Trade for a ${weakest.pos}`
                        : `Needs a ${weakest.pos}`
                      : isMine
                        ? "Balanced lineup"
                        : "No glaring hole"}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {isMine ? "Your" : "Their"} {weakest.pos} room ranks #{weakest.rank} of{" "}
                    {weakest.teams} at {weakest.ppg.toFixed(1)} projected points a week, the weakest
                    spot in the lineup.
                  </p>
                  {isMine && weakest.rank > Math.ceil(weakest.teams / 2) ? (
                    <Link
                      to="/trade"
                      className="mt-2 inline-block text-sm font-semibold text-primary hover:underline"
                    >
                      Find {weakest.pos} trades
                    </Link>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {slotRanks.isLoading
                    ? "Projecting the lineup…"
                    : "Rest-of-season projections aren't available yet."}
                </p>
              )}
              {strongest && strongest.rank != null && strongest.pos !== weakest?.pos ? (
                <div className="border-t border-slate-100 pt-4">
                  <p className="text-sm font-bold text-slate-900">
                    Strength: {strongest.pos} room #{strongest.rank} of {strongest.teams}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {strongest.ppg.toFixed(1)} projected points a week.{" "}
                    {isMine
                      ? "Depth here is the best trade currency."
                      : "A likely trade partner at this spot."}
                  </p>
                </div>
              ) : null}
            </div>
          </section>

          <section>
            <SectionTitle>Season Forecast</SectionTitle>
            <div className={cn(boxClass, "p-5")}>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-3">
                  <p className={labelClass}>Projected Record</p>
                  <p className="mt-1 text-xl font-black tabular-nums text-slate-900">
                    {projectedRecord ?? pending}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-3">
                  <p className={labelClass}>Projected Finish</p>
                  <p className="mt-1 text-xl font-black tabular-nums text-slate-900">
                    {stats?.projectedFinish != null
                      ? ordinal(Math.round(stats.projectedFinish))
                      : pending}
                  </p>
                </div>
              </div>
              <div className="mt-5 space-y-4">
                {[
                  { label: "Make playoffs", value: stats?.playoffPct, bar: "bg-emerald-500" },
                  {
                    label: "Earn first-round bye",
                    value: stats?.byePct,
                    bar: "bg-blue-500",
                    note:
                      stats && stats.byePct == null
                        ? "This bracket has no first-round byes."
                        : null,
                  },
                  { label: "Win championship", value: stats?.titlePct, bar: "bg-amber-500" },
                ].map((row) => (
                  <div key={row.label}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-semibold text-slate-800">{row.label}</span>
                      <span className="text-sm font-black tabular-nums text-slate-900">
                        {row.note ? "N/A" : pct(row.value)}
                      </span>
                    </div>
                    {row.note ? <p className="text-xs text-slate-500">{row.note}</p> : null}
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={cn(
                          "h-full rounded-full transition-[width] duration-500",
                          row.bar,
                        )}
                        style={{ width: `${row.note ? 0 : Math.min(100, row.value ?? 0)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>

      <section>
        <SectionTitle>Schedule</SectionTitle>
        <div className={cn(boxClass, "overflow-hidden")}>
          <div
            className="-mb-px -mr-px grid grid-cols-4 sm:grid-cols-[repeat(var(--sched-cols),minmax(0,1fr))]"
            style={{ "--sched-cols": scheduleCols } as CSSProperties}
          >
            {schedule.map((w) => {
              const opp =
                w.oppId != null ? (teams.find((t) => Number(t.slot) === w.oppId) ?? null) : null;
              const current = w.week === currentWeek;
              return (
                <div
                  key={w.week}
                  className={cn(
                    "flex min-w-0 flex-col items-center gap-1.5 border-b border-r border-slate-100 px-2 py-4 text-center",
                    current && "bg-blue-50/60",
                  )}
                >
                  <span
                    className={cn(
                      "text-[10px] font-bold uppercase tracking-wider",
                      current ? "text-blue-600" : "text-slate-400",
                    )}
                  >
                    Wk {w.week}
                  </span>
                  {opp ? (
                    <MatchupTeamAvatar
                      name={opp.team}
                      logo={opp.logo}
                      platform={platform}
                      cacheKey={`${leagueKey}-sched-${opp.slot}`}
                    />
                  ) : (
                    <span className="size-10 rounded-lg border border-dashed border-slate-200" />
                  )}
                  <span
                    className="w-full truncate text-xs font-semibold text-slate-700"
                    title={opp?.team}
                  >
                    {opp?.team ?? "TBD"}
                  </span>
                  {w.result ? (
                    <span
                      className={cn(
                        "text-xs font-black uppercase",
                        w.result === "W"
                          ? "text-emerald-600"
                          : w.result === "L"
                            ? "text-rose-600"
                            : "text-slate-500",
                      )}
                    >
                      {w.result === "W" ? "Win" : w.result === "L" ? "Loss" : "Tie"}
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "text-xs font-black tabular-nums",
                        w.winPct == null
                          ? "text-slate-400"
                          : w.winPct >= 55
                            ? "text-emerald-600"
                            : w.winPct <= 45
                              ? "text-rose-600"
                              : "text-slate-700",
                      )}
                    >
                      {w.winPct == null ? "—" : `${w.winPct}%`}
                    </span>
                  )}
                  <span className="text-[11px] tabular-nums text-slate-400">{w.score ?? ""}</span>
                </div>
              );
            })}
            {scheduleSummary ? (
              <div
                className="col-span-full flex flex-col items-center justify-center gap-1 border-b border-r border-slate-100 bg-slate-50/70 px-3 py-4 text-center sm:[grid-column:span_var(--sched-span)/span_var(--sched-span)]"
                style={{ "--sched-span": scheduleSummary.span } as CSSProperties}
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Rest of Season
                </span>
                <span className="text-lg font-black tabular-nums text-slate-900">
                  {scheduleSummary.expectedWins.toFixed(1)}
                  <span className="ml-1 text-xs font-semibold text-slate-500">exp. wins</span>
                </span>
                <span className="text-[11px] text-slate-500">in {scheduleSummary.games} games</span>
                <span className="text-[11px] font-semibold text-rose-600">
                  Toughest Wk {scheduleSummary.toughest.week} · {scheduleSummary.toughest.winPct}%
                </span>
                <span className="text-[11px] font-semibold text-emerald-600">
                  Easiest Wk {scheduleSummary.easiest.week} · {scheduleSummary.easiest.winPct}%
                </span>
              </div>
            ) : null}
            {!schedule.length ? (
              <p className="col-span-full px-5 py-4 text-sm text-muted-foreground">
                {league.historyLoading || league.scheduleLoading
                  ? "Loading schedule…"
                  : "No schedule available yet."}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section>
        <SectionTitle>Bye Week Planner</SectionTitle>
        <p className="-mt-1 mb-3 text-sm text-slate-500">
          See where the starting lineup gets thin and plan ahead. Starters are the best lineup by
          projected points per game.
        </p>
        {byePlan.length ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <div className={cn(boxClass, "p-4")}>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
                {byePlan.map((b) => {
                  const active = selectedBye?.week === b.week;
                  const statusLabel =
                    b.status === "none"
                      ? "No impact"
                      : b.status === "covered"
                        ? "Covered"
                        : b.status === "moderate"
                          ? "Moderate"
                          : "Thin";
                  const statusTone =
                    b.status === "none"
                      ? "text-slate-400"
                      : b.status === "covered"
                        ? "text-emerald-600"
                        : b.status === "moderate"
                          ? "text-amber-600"
                          : "text-rose-600";
                  return (
                    <button
                      key={b.week}
                      type="button"
                      onClick={() => setByeWeekPick(b.week)}
                      className={cn(
                        "cursor-pointer rounded-lg border px-2 py-2 text-center transition-colors",
                        active
                          ? "border-blue-400 bg-blue-50/70"
                          : "border-slate-200 bg-white hover:bg-slate-50",
                      )}
                    >
                      <span className="block text-sm font-black text-slate-900">W{b.week}</span>
                      <span
                        className={cn(
                          "block text-[10px] font-bold uppercase tracking-wide",
                          statusTone,
                        )}
                      >
                        {statusLabel}
                      </span>
                      <span className="block text-[11px] text-slate-400">
                        {b.swaps.length
                          ? `${b.swaps.length} starter${b.swaps.length === 1 ? "" : "s"}`
                          : "no starters"}
                      </span>
                    </button>
                  );
                })}
              </div>
              {selectedBye ? (
                <div className="mt-5">
                  <p className={labelClass}>Bench available in Week {selectedBye.week}</p>
                  <div className="mt-3 flex flex-wrap gap-4">
                    {selectedBye.available.slice(0, 8).map((b) => (
                      <button
                        key={b.player.id}
                        type="button"
                        onClick={() => onOpenPlayer(b.player.id)}
                        className="flex w-20 cursor-pointer flex-col items-center gap-1 text-center"
                      >
                        <span className={cn("text-[10px] font-black", POS_TEXT[b.player.pos])}>
                          {b.player.pos}
                        </span>
                        <Headshot player={b.player} className="size-12" />
                        <span className="w-full truncate text-xs font-semibold text-slate-800">
                          {shortName(b.player.name)}
                        </span>
                        <span className="text-xs font-bold tabular-nums text-slate-900">
                          {b.ppg.toFixed(1)}{" "}
                          <span className="text-[10px] font-medium text-slate-400">PPG</span>
                        </span>
                      </button>
                    ))}
                    {!selectedBye.available.length ? (
                      <p className="text-sm text-muted-foreground">
                        No healthy bench players that week.
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
            {selectedBye ? (
              <div className={cn(boxClass, "p-4")}>
                <p className="text-sm font-black text-slate-900">
                  Week {selectedBye.week}
                  <span className="ml-2 text-xs font-medium text-slate-500">
                    {selectedBye.swaps.length
                      ? `${selectedBye.swaps.length} starter${selectedBye.swaps.length === 1 ? "" : "s"} on bye`
                      : "No starters on bye"}
                  </span>
                </p>
                <div className="mt-3 space-y-3">
                  {selectedBye.swaps.map(({ seat, sub, short }) => (
                    <div
                      key={seat.label}
                      className="rounded-lg border border-slate-100 bg-slate-50/60 p-3"
                    >
                      <button
                        type="button"
                        onClick={() => onOpenPlayer(seat.player.id)}
                        className="flex cursor-pointer items-center gap-2.5 text-left"
                      >
                        <Headshot player={seat.player} className="size-9" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold text-slate-900">
                            {seat.player.name}
                          </span>
                          <span className="block text-[11px] font-semibold text-slate-500">
                            <span className={POS_TEXT[seat.player.pos]}>{seat.label}</span> ·{" "}
                            {seat.player.team} · {seat.ppg.toFixed(1)} PPG
                          </span>
                        </span>
                      </button>
                      <p className="mt-2 text-xs text-slate-600">
                        {sub
                          ? `${shortName(sub.player.name)} (${sub.ppg.toFixed(1)} PPG) steps in, ${short.toFixed(1)} PPG short of ${shortName(seat.player.name)}.`
                          : `No bench player can fill ${seat.label}. ${seat.ppg.toFixed(1)} PPG lost unless you add one.`}
                      </p>
                    </div>
                  ))}
                  {!selectedBye.swaps.length ? (
                    <p className="text-sm text-slate-500">
                      The starting lineup is untouched this week.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className={cn(boxClass, "p-5 text-sm text-muted-foreground")}>
            {slotRanks.isLoading ? "Planning bye weeks…" : "No remaining bye weeks."}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>Full Roster</SectionTitle>
        {[
          { title: "Starters", spots: roster.filter((r) => r.label !== "BN" && r.label !== "IR") },
          { title: "Bench", spots: roster.filter((r) => r.label === "BN" || r.label === "IR") },
        ]
          .filter((group) => group.spots.length)
          .map((group) => (
            <div key={group.title} className="mb-5 last:mb-0">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <p className={labelClass}>{group.title}</p>
                <p className="text-[11px] font-semibold tabular-nums text-slate-400">
                  {group.title === "Starters"
                    ? `${group.spots.reduce((s, r) => s + (r.player ? (ppgOf(r.player.id) ?? 0) : 0), 0).toFixed(1)} proj. PPG`
                    : `${group.spots.filter((r) => r.player).length} players`}
                </p>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3">
                {group.spots.map(({ label, player }, i) => {
                  const base = label.replace(/\d+$/, "");
                  const chip = SLOT_CHIP[base] ?? "bg-slate-100 text-slate-500 border-slate-200";
                  if (!player) {
                    return (
                      <div
                        key={`${label}-${i}`}
                        className="flex min-w-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-10"
                      >
                        <span
                          className={cn(
                            "rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase",
                            chip,
                          )}
                        >
                          {label}
                        </span>
                        <span className="text-xs text-slate-400">Empty</span>
                      </div>
                    );
                  }
                  const ppg = ppgOf(player.id);
                  const injury = (player.injury_status ?? "").trim();
                  return (
                    <button
                      key={`${label}-${player.id}`}
                      type="button"
                      onClick={() => onOpenPlayer(player.id)}
                      className={cn(
                        "relative flex min-w-0 cursor-pointer flex-col items-center overflow-hidden rounded-xl border border-border bg-card pb-3 text-center transition-shadow hover:shadow-md",
                        label === "IR" && "opacity-70",
                      )}
                    >
                      {injury ? (
                        <span className="absolute right-1.5 top-1.5 z-10 rounded bg-amber-100 px-1 text-[10px] font-black uppercase text-amber-700">
                          {injury === "Questionable"
                            ? "Q"
                            : injury === "Doubtful"
                              ? "D"
                              : injury === "Out"
                                ? "O"
                                : injury.slice(0, 2)}
                        </span>
                      ) : null}
                      <div className="flex h-24 w-full items-end justify-center bg-slate-50">
                        <Headshot
                          player={player}
                          className="size-20 rounded-b-none rounded-t-full border-0 bg-transparent"
                        />
                      </div>
                      <span className="mt-2 w-full truncate px-2 text-xs font-bold text-slate-900">
                        {player.name}
                      </span>
                      <span className="text-[10px] font-semibold text-slate-500">
                        <span className={POS_TEXT[player.pos]}>{player.pos}</span> ·{" "}
                        {player.team || "FA"}
                      </span>
                      <span className="mt-0.5 text-[11px] text-slate-500">
                        PPG{" "}
                        <span className="font-bold tabular-nums text-slate-900">
                          {ppg != null ? ppg.toFixed(1) : "—"}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "mt-1.5 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase",
                          chip,
                        )}
                      >
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        <p className="mt-2 text-xs text-slate-500">
          PPG is projected rest-of-season points per game in this league's scoring.
        </p>
      </section>
    </div>
  );
}
