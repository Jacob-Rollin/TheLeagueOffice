import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  ActivityFeed,
  LeagueActivityTimeline,
} from "@/components/dashboard/ActivityFeed";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useActiveStandings } from "@/hooks/useActiveStandings";
import { useLeagueActivity } from "@/hooks/useLeagueActivity";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useLeagueRosters, type ResolvedRosterTeam } from "@/hooks/useLeagueRosters";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Player } from "@/lib/draft";
import { buildTruePowerRankings, starterRequirements } from "@/lib/power-rankings";
import { scaleValue } from "@/lib/trade-engine";
import { cn } from "@/lib/utils";

export { ActivityFeed, LeagueActivityTimeline };

export const playbookCardClass = "rounded-xl border border-border bg-card p-6";

function teamInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "TM";
  const letters = cleaned.replace(/[^a-zA-Z0-9]/g, "");
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

export function resolveAvatarUrl(raw?: string | null): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  if (
    value === "0" ||
    lower === "default" ||
    lower === "null" ||
    lower === "undefined" ||
    lower === "none"
  ) {
    return null;
  }
  if (/sleepercdn\.com\/avatars(?:\/thumbs)?\/(?:0|default)(?:[/?#.]|$)/i.test(value)) {
    return null;
  }
  if (/\/(?:0|default)(?:\.[a-z0-9]+)?(?:[?#]|$)/i.test(value)) {
    return null;
  }
  return value;
}

const POWER_RANK_BASELINE_KEY = "tlo.power-rank-baseline";
const POWER_RANK_LATEST_KEY = "tlo.power-rank-latest";
const POWER_RANK_SESSION_KEY = "tlo.power-rank-session";

function readRankMap(storageKey: string, leagueKey: string): Record<string, number> | null {
  try {
    const raw = window.localStorage.getItem(`${storageKey}.${leagueKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeRankMap(storageKey: string, leagueKey: string, ranks: Record<string, number>) {
  try {
    window.localStorage.setItem(`${storageKey}.${leagueKey}`, JSON.stringify(ranks));
  } catch {
    /* storage unavailable */
  }
}

function ranksMapFromRows(rows: { slot: number; rank: number }[]): Record<string, number> {
  const next: Record<string, number> = {};
  for (const row of rows) next[String(row.slot)] = row.rank;
  return next;
}

function ranksMapsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export function readPowerRankBaseline(leagueKey: string): Record<string, number> | null {
  return readRankMap(POWER_RANK_BASELINE_KEY, leagueKey);
}

export function writePowerRankBaseline(leagueKey: string, ranks: Record<string, number>) {
  writeRankMap(POWER_RANK_BASELINE_KEY, leagueKey, ranks);
}

/** Clear leftover experimental session snapshots from prior builds. */
function clearPowerRankSessionSnapshot(leagueKey: string) {
  try {
    window.sessionStorage.removeItem(`${POWER_RANK_SESSION_KEY}.${leagueKey}`);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Persistent week-over-week comparison ranks for cold mounts.
 * - `baseline`: historical ranks used for trend math (prev_rank)
 * - `latest`: last computed ranks written after a successful resolve
 *
 * When current ranks differ from `latest`, `latest` is promoted into
 * `baseline` and current becomes the new `latest`. Display compares against
 * the pre-update historical set so the first paint after a real move shows ▲/▼.
 */
export function resolvePowerRankDisplayBaseline(
  leagueKey: string,
  rows: { slot: number; rank: number }[],
): Record<string, number> | null {
  clearPowerRankSessionSnapshot(leagueKey);
  if (!rows.length) return readPowerRankBaseline(leagueKey);

  const current = ranksMapFromRows(rows);
  const baseline = readPowerRankBaseline(leagueKey);
  const latest = readRankMap(POWER_RANK_LATEST_KEY, leagueKey);

  if (!latest) {
    writeRankMap(POWER_RANK_LATEST_KEY, leagueKey, current);
    if (!baseline) writePowerRankBaseline(leagueKey, current);
    // First seed only — no prior history to compare on this cold mount.
    return baseline && Object.keys(baseline).length ? baseline : null;
  }

  if (!ranksMapsEqual(latest, current)) {
    // Ranks moved since last persist: compare against previous latest, then store.
    writePowerRankBaseline(leagueKey, latest);
    writeRankMap(POWER_RANK_LATEST_KEY, leagueKey, current);
    return latest;
  }

  return baseline && Object.keys(baseline).length ? baseline : null;
}

/** Persistent historical math: prev_rank - current_rank. */
export function powerRankMovementDelta(
  baseline: Record<string, number> | null | undefined,
  slot: number,
  currentRank: number,
): number | null {
  if (!baseline) return null;
  const prevRank = baseline[String(slot)];
  if (prevRank == null || !Number.isFinite(prevRank)) return null;
  return prevRank - currentRank;
}

function TeamAvatarBadge({
  name,
  logo,
  platform,
  cacheKey,
}: {
  name: string;
  logo?: string | null;
  platform?: string | null;
  cacheKey?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const src = resolveAvatarUrl(logo);
  const plat = (platform ?? "").trim().toLowerCase();
  const remountKey = `${cacheKey ?? "rank"}:${src ?? "none"}:${plat}`;

  useEffect(() => {
    setFailed(false);
  }, [src, cacheKey, plat]);

  if (src && !failed) {
    return (
      <span
        key={remountKey}
        className="mr-3 flex h-7 w-7 shrink-0 overflow-hidden rounded-full border border-slate-200/80 bg-slate-100"
      >
        <img
          key={remountKey}
          src={src}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  if (plat === "espn") {
    return (
      <span
        key={remountKey}
        className="mr-3 flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200/80 bg-white p-0.5"
      >
        <img src="/espn.png" alt="ESPN" className="h-5 w-5 object-contain" aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      key={remountKey}
      className="mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200/80 bg-slate-100 text-xs font-bold text-slate-600"
    >
      {teamInitials(name)}
    </span>
  );
}

export function LeagueActivityWirePanel() {
  const { events, loading, error } = useLeagueActivity();

  return (
    <section className={playbookCardClass}>
      <div className="mb-4">
        <h2 className="display-title text-lg font-bold uppercase tracking-wide text-slate-900">
          League Activity
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Live waiver, free agent, trade, and IR moves from the active host league.
        </p>
      </div>

      <ActivityFeed events={events} loading={loading} error={error} />
    </section>
  );
}

export function TruePowerRankingsPanel() {
  const navigate = useNavigate();
  const { activeLeague, activeLeagueId } = useActiveLeague();
  const leagueKey = activeLeague?.id ?? "none";
  const platform = activeLeague?.platform ?? null;
  const { data: playersPayload, loading: playersLoading } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const { teams, rosterPositions, loading: rostersLoading } = useLeagueRosters(players);
  const { standings, loading: standingsLoading } = useActiveStandings();
  const { projectFor, loading: projectionsLoading } = useLeagueProjections();
  const brain = usePlayerBrain();
  const [baseline, setBaseline] = useState<Record<string, number> | null>(null);

  const loading = playersLoading || rostersLoading || standingsLoading || projectionsLoading;

  const logoBySlot = useMemo(() => {
    const map = new Map<number, string | null>();
    for (const team of teams) map.set(team.slot, team.logo);
    return map;
  }, [teams]);

  const rows = useMemo(() => {
    if (!teams.length) return [];
    const standingBySlot = new Map((standings?.rows ?? []).map((r) => [r.rosterId, r]));
    const inputs = teams.map((team) => {
      const standing = standingBySlot.get(team.slot);
      return {
        slot: team.slot,
        team: team.team,
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
      projectFor,
      rosterPositions,
    });
  }, [teams, standings, brain, projectFor, rosterPositions]);

  useEffect(() => {
    setBaseline(resolvePowerRankDisplayBaseline(leagueKey, rows));
  }, [leagueKey, rows]);

  const scoutRoster = (slot: number) => {
    void navigate({
      to: "/playbook/rosters",
      search: { scout: String(slot) },
    });
  };

  const headerCell =
    "border-0 px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-50/50";
  const headerCellRank =
    "border-0 pl-4 pr-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-50/50";
  const headerCellRight =
    "border-0 px-3 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-50/50";
  const headerCellScout =
    "border-0 px-3 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-50/50";

  const rankBadgeClass = (rank: number): string => {
    if (rank === 1) {
      return "inline-flex min-w-[2.75rem] items-center justify-center rounded-lg border border-amber-200 bg-amber-100/80 px-3 py-1 text-center text-xs font-extrabold text-amber-900 shadow-sm";
    }
    if (rank === 2) {
      return "inline-flex min-w-[2.75rem] items-center justify-center rounded-lg border border-slate-200 bg-slate-100 px-3 py-1 text-center text-xs font-extrabold text-slate-900 shadow-sm";
    }
    if (rank === 3) {
      return "inline-flex min-w-[2.75rem] items-center justify-center rounded-lg border border-orange-200/40 bg-orange-100/60 px-3 py-1 text-center text-xs font-extrabold text-orange-800 shadow-sm";
    }
    return "inline-flex min-w-[2.75rem] items-center justify-center px-3 py-1 text-center text-xs font-semibold tabular-nums text-slate-500";
  };

  return (
    <section key={activeLeagueId ?? leagueKey} className={playbookCardClass}>
      <div className="mb-4">
        <h2 className="display-title text-lg font-bold uppercase tracking-wide text-slate-900">
          True Power Rankings
        </h2>
      </div>

      <div className="overflow-x-auto overflow-y-hidden rounded-lg border border-border">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={headerCellRank}>Rank</th>
              <th className={headerCell}>Trend</th>
              <th className={headerCell}>Team</th>
              <th className={headerCellRight}>True Power Index</th>
              <th className={headerCellRight}>Roster Market Value</th>
              <th className={headerCellRight}>Weekly Optimal Projection</th>
              <th className={headerCellRight}>Record / Points For</th>
              <th className={headerCellScout}>Scout</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-muted-foreground">
                  Calculating true power rankings…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-muted-foreground">
                  No roster data available for this league yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const delta = powerRankMovementDelta(baseline, row.slot, row.rank);
                const trendLabel =
                  delta == null || delta === 0
                    ? "—"
                    : delta > 0
                      ? `▲ ${delta}`
                      : `▼ ${Math.abs(delta)}`;
                const trendClass =
                  delta == null || delta === 0
                    ? "text-xs font-semibold tabular-nums text-slate-400"
                    : delta > 0
                      ? "text-xs font-semibold tabular-nums text-emerald-600"
                      : "text-xs font-semibold tabular-nums text-rose-600";
                const podiumClass =
                  row.rank === 1
                    ? "bg-amber-500/[0.01] border-l-2 border-l-amber-500"
                    : row.rank === 2
                      ? "bg-slate-400/[0.005] border-l-2 border-l-slate-400"
                      : row.rank === 3
                        ? "bg-orange-600/[0.005] border-l-2 border-l-amber-700/60"
                        : "";

                return (
                  <tr key={row.slot} className={cn("border-t border-border", podiumClass)}>
                    <td className="pl-4 pr-3 py-2">
                      <span className={rankBadgeClass(row.rank)}>#{row.rank}</span>
                    </td>
                    <td className={cn("px-3 py-2 tabular-nums", trendClass)}>{trendLabel}</td>
                    <td className="px-3 py-2">
                      <div className="flex min-w-0 items-center">
                        <TeamAvatarBadge
                          key={`${activeLeagueId ?? leagueKey}-${row.slot}-${resolveAvatarUrl(logoBySlot.get(row.slot) ?? null) ?? "fallback"}`}
                          name={row.team}
                          logo={logoBySlot.get(row.slot) ?? null}
                          platform={platform}
                          cacheKey={`${activeLeagueId ?? leagueKey}-${row.slot}`}
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">{row.team}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {row.owner || "Owner"}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-foreground">
                      {row.powerIndex.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {row.marketValue.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {row.weeklyProjection.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {row.recordLabel}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        aria-label={`Scout ${row.team}`}
                        className="ml-auto inline-flex cursor-pointer items-center justify-center text-slate-400 transition-colors hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        onClick={() => scoutRoster(row.slot)}
                      >
                        <Search className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const SKIP_STARTER_SLOTS = new Set(["BN", "BENCH", "IR", "IL", "TAXI", "RESERVE"]);
const FLEX_OK = new Set(["RB", "WR", "TE"]);
const weeklyFallback = (p: Player) => Math.max(0, (p.proj?.half ?? 0) / 17);

type MatrixRow = {
  slot: string;
  player: Player | null;
};

function starterSlotLabels(rosterPositions: string[]): string[] {
  const labels = rosterPositions
    .map((pos) => String(pos ?? "").trim().toUpperCase())
    .filter((pos) => pos && !SKIP_STARTER_SLOTS.has(pos))
    .map((pos) =>
      pos === "SUPER_FLEX" || pos === "SUPERFLEX" || pos === "Q/W/R/T"
        ? "FLEX"
        : pos === "W/R/T" || pos === "WRRBTE"
          ? "FLEX"
          : pos,
    );
  if (labels.length) return labels;
  const req = starterRequirements([]);
  const out: string[] = [];
  for (const pos of ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"]) {
    for (let i = 0; i < (req[pos] ?? 0); i += 1) out.push(pos);
  }
  return out;
}

function buildStarterRows(
  team: ResolvedRosterTeam,
  rosterPositions: string[],
  projectFor: (id: string) => number | null,
): MatrixRow[] {
  const labels = starterSlotLabels(rosterPositions);
  const native = team.starters ?? [];

  if (native.length) {
    return labels.map((slot, i) => ({
      slot,
      player: native[i] ?? null,
    }));
  }

  const pool = team.players
    .filter((p) => !(team.ir ?? []).some((ir) => ir.id === p.id))
    .map((p) => ({
      id: p.id,
      pos: p.pos,
      weekly: projectFor(p.id) ?? weeklyFallback(p),
      player: p,
    }))
    .sort((a, b) => b.weekly - a.weekly);

  const used = new Set<string>();
  const rows: MatrixRow[] = [];
  for (const slot of labels) {
    const match = pool.find((p) => {
      if (used.has(p.id)) return false;
      if (slot === "FLEX") return FLEX_OK.has(p.pos);
      return p.pos === slot;
    });
    if (match) used.add(match.id);
    rows.push({ slot, player: match?.player ?? null });
  }

  return rows;
}

export function RosterMatrixPanel({
  preferredSlot,
  lockToPreferred = false,
}: {
  preferredSlot?: string | null;
  lockToPreferred?: boolean;
}) {
  const navigate = useNavigate();
  const { data: playersPayload, loading: playersLoading } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const { teams, myTeam, rosterPositions, loading: rostersLoading } = useLeagueRosters(players);
  const { projectFor, loading: projectionsLoading } = useLeagueProjections();
  const brain = usePlayerBrain();
  const [selectedSlot, setSelectedSlot] = useState<string>("");

  useEffect(() => {
    if (preferredSlot && teams.some((t) => String(t.slot) === preferredSlot)) {
      setSelectedSlot(preferredSlot);
      return;
    }
    if (lockToPreferred) return;
    if (!teams.length) {
      setSelectedSlot("");
      return;
    }
    const stillValid = teams.some((t) => String(t.slot) === selectedSlot);
    if (stillValid) return;
    const preferred = myTeam ?? teams[0];
    setSelectedSlot(preferred ? String(preferred.slot) : "");
  }, [teams, myTeam, selectedSlot, preferredSlot, lockToPreferred]);

  const selectManager = (slot: string) => {
    setSelectedSlot(slot);
    void navigate({
      to: "/playbook/rosters",
      search: slot ? { scout: slot } : {},
      replace: true,
    });
  };

  const selectedTeam = useMemo(
    () => teams.find((t) => String(t.slot) === selectedSlot) ?? null,
    [teams, selectedSlot],
  );

  const starterRows = useMemo(() => {
    if (!selectedTeam) return [] as MatrixRow[];
    return buildStarterRows(selectedTeam, rosterPositions, projectFor);
  }, [selectedTeam, rosterPositions, projectFor]);

  const starterIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of starterRows) if (row.player) ids.add(row.player.id);
    return ids;
  }, [starterRows]);

  const benchRows = useMemo(() => {
    if (!selectedTeam) return [] as MatrixRow[];
    const irIds = new Set((selectedTeam.ir ?? []).map((p) => p.id));
    return (selectedTeam.bench ?? [])
      .filter((p) => !starterIds.has(p.id) && !irIds.has(p.id))
      .map((p) => ({ slot: "BN", player: p }));
  }, [selectedTeam, starterIds]);

  const irRows = useMemo(() => {
    if (!selectedTeam) return [] as MatrixRow[];
    return (selectedTeam.ir ?? []).map((p) => ({ slot: "IR", player: p }));
  }, [selectedTeam]);

  const loading = playersLoading || rostersLoading || projectionsLoading;

  const valueTrend = (p: Player | null) => {
    if (!p) return "—";
    const entry = brain?.[p.id];
    const value = scaleValue(entry?.value ?? 0);
    const trend = entry?.trend ?? 0;
    const trendText = `${trend >= 0 ? "+" : ""}${trend.toFixed(1)}`;
    return `${value.toFixed(1)} / ${trendText}`;
  };

  const projPts = (p: Player | null) => {
    if (!p) return "—";
    const pts = projectFor(p.id) ?? weeklyFallback(p);
    return pts.toFixed(1);
  };

  const playerLabel = (p: Player | null) => {
    if (!p) return "Empty slot";
    const team = p.team?.trim() || "FA";
    return `${p.name} - ${team}`;
  };

  return (
    <section className={playbookCardClass}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display-title text-lg uppercase tracking-wide">
            {lockToPreferred ? "My Team" : "Roster Matrix"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {lockToPreferred
              ? "Your starting lineup, bench depth, and IR slots for the active league."
              : "Scout any manager lineup, bench depth, and IR slots in the active league."}
          </p>
        </div>
        {!lockToPreferred ? (
          <label className="flex min-w-[14rem] flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Manager Team
            <select
              value={selectedSlot}
              onChange={(e) => selectManager(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium normal-case tracking-normal text-foreground outline-none focus:border-ring"
            >
              {!teams.length ? <option value="">No teams available</option> : null}
              {teams.map((team) => (
                <option key={team.slot} value={String(team.slot)}>
                  {team.team}
                  {team.owner ? ` · ${team.owner}` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {loading && !selectedTeam ? (
        <p className="text-sm text-muted-foreground">Loading roster matrix…</p>
      ) : !selectedTeam ? (
        <p className="text-sm text-muted-foreground">No roster data available for this league yet.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <RosterColumn
            title="Starting Lineup"
            rows={starterRows}
            valueTrend={valueTrend}
            projPts={projPts}
            playerLabel={playerLabel}
          />
          <div className="space-y-4">
            <RosterColumn
              title="Bench Depth"
              rows={benchRows}
              valueTrend={valueTrend}
              projPts={projPts}
              playerLabel={playerLabel}
              empty="No bench assets on this roster."
            />
            <RosterColumn
              title="Injured Reserve"
              rows={irRows}
              valueTrend={valueTrend}
              projPts={projPts}
              playerLabel={playerLabel}
              empty="IR slot empty."
            />
          </div>
        </div>
      )}
    </section>
  );
}

function RosterColumn({
  title,
  rows,
  valueTrend,
  projPts,
  playerLabel,
  empty,
}: {
  title: string;
  rows: MatrixRow[];
  valueTrend: (p: Player | null) => string;
  projPts: (p: Player | null) => string;
  playerLabel: (p: Player | null) => string;
  empty?: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="border-b border-border bg-muted/40 px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/20">
              <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Pos
              </th>
              <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Player
              </th>
              <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Value/Trend
              </th>
              <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Proj
              </th>
            </tr>
          </thead>
          <tbody>
            {!rows.length ? (
              <tr>
                <td colSpan={4} className="px-3 py-5 text-muted-foreground">
                  {empty ?? "No players in this panel."}
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr
                  key={`${row.slot}-${row.player?.id ?? "empty"}-${index}`}
                  className="border-t border-border"
                >
                  <td className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {row.slot}
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      className={cn(
                        "block truncate text-sm",
                        row.player ? "font-medium text-foreground" : "italic text-muted-foreground",
                      )}
                    >
                      {playerLabel(row.player)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                    {valueTrend(row.player)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium text-foreground">
                    {projPts(row.player)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
