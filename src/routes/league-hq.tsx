import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
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

type HqTab = "rankings" | "rosters" | "activity";

type HqSearch = {
  tab?: HqTab;
  scout?: string;
};

export const Route = createFileRoute("/league-hq")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): HqSearch => {
    const rawTab = search["tab"];
    const tab: HqTab | undefined =
      rawTab === "rosters" || rawTab === "roster"
        ? "rosters"
        : rawTab === "activity"
          ? "activity"
          : rawTab === "rankings"
            ? "rankings"
            : undefined;
    const scout = typeof search["scout"] === "string" ? search["scout"] : undefined;
    return {
      ...(tab ? { tab } : {}),
      ...(scout ? { scout } : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "League HQ — The League Office" },
      {
        name: "description",
        content: "League power rankings, roster matrix, and activity wire for your active synced league.",
      },
      { property: "og:title", content: "League HQ — The League Office" },
      { property: "og:description", content: "Your centralized fantasy league dashboard." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LeagueHqPage,
});

const cardClass = "rounded-xl border border-border bg-card p-6";
const blueButton =
  "rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-60";

const POWER_RANK_BASELINE_KEY = "tlo.power-rank-baseline";

function readPowerRankBaseline(leagueKey: string): Record<string, number> | null {
  try {
    const raw = window.localStorage.getItem(`${POWER_RANK_BASELINE_KEY}.${leagueKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writePowerRankBaseline(leagueKey: string, ranks: Record<string, number>) {
  try {
    window.localStorage.setItem(`${POWER_RANK_BASELINE_KEY}.${leagueKey}`, JSON.stringify(ranks));
  } catch {
    /* storage unavailable */
  }
}

function teamInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "TM";
  const letters = cleaned.replace(/[^a-zA-Z0-9]/g, "");
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

function TeamAvatarBadge({ name, logo }: { name: string; logo?: string | null }) {
  const [failed, setFailed] = useState(false);
  const src = logo?.trim() || "";
  if (src && !failed) {
    return (
      <span className="mr-3 flex h-7 w-7 shrink-0 overflow-hidden rounded-full border border-slate-200/80 bg-slate-100">
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }
  return (
    <span className="mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200/80 bg-slate-100 text-xs font-bold text-slate-600">
      {teamInitials(name)}
    </span>
  );
}

function LeagueHqPage() {
  const { ready, user } = useAuth();
  const { activeLeague, leagues } = useActiveLeague();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/league-hq" });
  const tab: HqTab = search.tab ?? "rankings";
  const [rankBaseline, setRankBaseline] = useState<Record<string, number> | null>(null);
  const leagueKey = activeLeague?.id ?? "none";

  useEffect(() => {
    if (!activeLeague) {
      setRankBaseline(null);
      return;
    }
    setRankBaseline(readPowerRankBaseline(leagueKey));
  }, [activeLeague, leagueKey]);

  const setTab = (next: HqTab) => {
    void navigate({
      to: "/league-hq",
      search: (prev) => {
        if (next === "rosters" && prev.scout) {
          return { tab: next, scout: prev.scout };
        }
        return { tab: next };
      },
    });
  };

  const scoutRoster = (slot: number) => {
    void navigate({
      to: "/league-hq",
      search: {
        tab: "rosters",
        scout: String(slot),
      },
    });
  };

  const tabClass = (value: HqTab) =>
    cn(
      "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
      tab === value
        ? "border-accent text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground",
    );

  if (!ready) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-10">
        <p className="text-sm text-muted-foreground">Loading league context…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-10">
        <section className={cardClass}>
          <h1 className="display-title text-3xl uppercase tracking-wide">League HQ</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in and sync a league to open your personalized League HQ dashboard.
          </p>
        </section>
      </main>
    );
  }

  if (!activeLeague) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-10">
        <section className={cardClass}>
          <h1 className="display-title text-3xl uppercase tracking-wide">League HQ</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {leagues.length === 0
              ? "No synced leagues yet. Sync a league to load rankings, rosters, and activity."
              : "Select a league from Active Operations to load this dashboard."}
          </p>
          <Link to="/account/leagues" className={cn(blueButton, "mt-5 inline-flex")}>
            + Sync New League
          </Link>
        </section>
      </main>
    );
  }

  const platform =
    activeLeague.platform.trim().toLowerCase() === "espn"
      ? "ESPN"
      : activeLeague.platform.trim().toLowerCase() === "sleeper"
        ? "Sleeper"
        : activeLeague.platform.trim().toLowerCase() === "yahoo"
          ? "Yahoo"
          : activeLeague.platform;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <header className="mb-5">
        <h1 className="display-title text-3xl uppercase tracking-wide">League HQ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {activeLeague.teamName?.trim() || activeLeague.name} · {platform}
        </p>
      </header>

      <div className="mb-5 flex gap-2 border-b border-border">
        <button type="button" className={tabClass("rankings")} onClick={() => setTab("rankings")}>
          True Power Rankings
        </button>
        <button type="button" className={tabClass("rosters")} onClick={() => setTab("rosters")}>
          Roster Matrix
        </button>
        <button type="button" className={tabClass("activity")} onClick={() => setTab("activity")}>
          League Activity Wire
        </button>
      </div>

      {tab === "rankings" ? (
        <TruePowerRankingsPanel onScoutRoster={scoutRoster} baseline={rankBaseline} />
      ) : tab === "rosters" ? (
        <RosterMatrixPanel preferredSlot={search.scout ?? null} />
      ) : (
        <LeagueActivityWirePanel />
      )}
    </main>
  );
}

function formatActivityTime(at: number): string {
  const diff = Date.now() - at;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function LeagueActivityWirePanel() {
  const { events, loading, error } = useLeagueActivity();

  return (
    <section className={cardClass}>
      <div className="mb-4">
        <h2 className="display-title text-lg uppercase tracking-wide">League Activity Wire</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Live waiver, free agent, trade, and IR moves from the active host league.
        </p>
      </div>

      <div className="h-80 overflow-y-auto rounded-lg border border-border bg-muted/20 p-3 pr-2">
        {loading ? (
          <p className="px-2 py-6 text-sm text-muted-foreground">Loading league activity…</p>
        ) : error ? (
          <p className="px-2 py-6 text-sm text-destructive">{error}</p>
        ) : !events.length ? (
          <p className="px-2 py-10 text-center text-sm text-muted-foreground">
            The wire is quiet. No recent transactions recorded.
          </p>
        ) : (
          <ul className="space-y-0 divide-y divide-border">
            {events.map((event) => (
              <li key={event.id} className="flex items-start gap-3 px-1 py-2.5">
                <span className="w-14 shrink-0 pt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {formatActivityTime(event.at)}
                </span>
                <p className="min-w-0 flex-1 text-sm leading-snug text-foreground">{event.text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function TruePowerRankingsPanel({
  onScoutRoster,
  baseline,
}: {
  onScoutRoster: (slot: number) => void;
  baseline: Record<string, number> | null;
}) {
  const { activeLeague } = useActiveLeague();
  const leagueKey = activeLeague?.id ?? "none";
  const { data: playersPayload, loading: playersLoading } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const { teams, rosterPositions, loading: rostersLoading } = useLeagueRosters(players);
  const { standings, loading: standingsLoading } = useActiveStandings();
  const { projectFor, loading: projectionsLoading } = useLeagueProjections();
  const brain = usePlayerBrain();

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

  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    return () => {
      const latest = rowsRef.current;
      if (!latest.length) return;
      const next: Record<string, number> = {};
      for (const row of latest) next[String(row.slot)] = row.rank;
      writePowerRankBaseline(leagueKey, next);
    };
  }, [leagueKey]);

  const headerCell =
    "border-0 px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-50/50";
  const headerCellRank =
    "border-0 pl-4 pr-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-50/50";
  const headerCellRight =
    "border-0 px-3 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-50/50";

  return (
    <section className={cardClass}>
      <div className="mb-4">
        <h2 className="display-title text-lg uppercase tracking-wide">True Power Rankings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Weighted index for {activeLeague?.name ?? "this league"}: 40% roster market value, 40%
          optimal weekly projection, 20% season points for.
        </p>
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
              <th className={headerCellRight}>Scout</th>
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
                const prevRank = baseline?.[String(row.slot)];
                const delta = prevRank != null ? prevRank - row.rank : null;
                const trendLabel =
                  delta == null ? "--" : delta === 0 ? "--" : delta > 0 ? `+${delta}` : `${delta}`;
                const trendClass =
                  delta == null || delta === 0
                    ? "text-slate-400"
                    : delta > 0
                      ? "text-emerald-600 font-semibold"
                      : "text-rose-600 font-semibold";
                const podiumClass =
                  row.rank === 1
                    ? "bg-amber-500/[0.01] border-l-2 border-l-amber-500"
                    : row.rank === 2
                      ? "bg-slate-400/[0.005] border-l-2 border-l-slate-400"
                      : row.rank === 3
                        ? "bg-orange-600/[0.005] border-l-2 border-l-orange-600"
                        : "";

                return (
                  <tr key={row.slot} className={cn("border-t border-border", podiumClass)}>
                    <td className="pl-4 pr-3 py-2 tabular-nums text-muted-foreground">#{row.rank}</td>
                    <td className={cn("px-3 py-2 tabular-nums", trendClass)}>{trendLabel}</td>
                    <td className="px-3 py-2">
                      <div className="flex min-w-0 items-center">
                        <TeamAvatarBadge name={row.team} logo={logoBySlot.get(row.slot)} />
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
                        className="text-sm font-semibold text-primary transition-colors hover:underline"
                        onClick={() => onScoutRoster(row.slot)}
                      >
                        Scout Roster
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

  // Fill a legal full lineup when the host platform did not return starter slots.
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

function RosterMatrixPanel({ preferredSlot }: { preferredSlot?: string | null }) {
  const navigate = useNavigate({ from: "/league-hq" });
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
    if (!teams.length) {
      setSelectedSlot("");
      return;
    }
    const stillValid = teams.some((t) => String(t.slot) === selectedSlot);
    if (stillValid) return;
    const preferred = myTeam ?? teams[0];
    setSelectedSlot(preferred ? String(preferred.slot) : "");
  }, [teams, myTeam, selectedSlot, preferredSlot]);

  const selectManager = (slot: string) => {
    setSelectedSlot(slot);
    void navigate({
      to: "/league-hq",
      search: slot
        ? { tab: "rosters", scout: slot }
        : { tab: "rosters" },
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
    <section className={cardClass}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display-title text-lg uppercase tracking-wide">Roster Matrix</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Scout any manager lineup, bench depth, and IR slots in the active league.
          </p>
        </div>
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
      </div>

      {loading && !selectedTeam ? (
        <p className="text-sm text-muted-foreground">Loading roster matrix…</p>
      ) : !selectedTeam ? (
        <p className="text-sm text-muted-foreground">No roster data available for this league yet.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <RosterColumn title="Starting Lineup" rows={starterRows} valueTrend={valueTrend} projPts={projPts} playerLabel={playerLabel} />
          <div className="space-y-4">
            <RosterColumn title="Bench Depth" rows={benchRows} valueTrend={valueTrend} projPts={projPts} playerLabel={playerLabel} empty="No bench assets on this roster." />
            <RosterColumn title="Injured Reserve" rows={irRows} valueTrend={valueTrend} projPts={projPts} playerLabel={playerLabel} empty="IR slot empty." />
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
