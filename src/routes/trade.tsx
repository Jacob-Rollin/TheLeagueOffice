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
  opponentImpact as computeOpponentImpact,
  packageScore,
  rosterConstraint,
  rosterFit,
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

/** Single selected-player row: name plus cached market assets, no raw labels. */
function MarketRow({ player, line }: { player: Player; line: MarketLine }) {
  return (
    <span className="block min-w-0">
      <span className="block truncate text-sm font-medium leading-tight text-foreground">
        {player.name}
      </span>
      <span className="tabnum block truncate text-[11px] leading-tight text-muted-foreground">
        {line.bits.join(" · ")}
        {line.trend ? " · " : ""}
        {line.trend ? (
          <span className={cn("font-medium", line.up ? "text-foreground" : "text-muted-foreground")}>
            {line.trend}
          </span>
        ) : null}
      </span>
    </span>
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
  let adjustedPct = basePct + needDelta;
  if (impact.delta > 0.25) adjustedPct = Math.max(adjustedPct, needDelta);
  if (impact.delta > 2) adjustedPct = Math.max(adjustedPct, 15);
  const adjustedGrade = grade(adjustedPct);
  const ready = give.length > 0 && get.length > 0;
  const verdict = executiveSummary({
    ready,
    pct: adjustedPct,
    giveCount: give.length,
    getCount: get.length,
    overflow: constraint.overflow,
    impact,
    opponentImpact: rivalImpact,
  });

  /** Sandbox / unsynced desks show asset value only — no lineup telemetry. */
  const valueOnly = sandboxMode || !league?.synced;
  const marketValue = (list: Player[]) =>
    list.reduce((s2, p) => s2 + Math.max(0, brain?.[p.id]?.value ?? 0), 0);
  const giveValue = marketValue(give);
  const getValue = marketValue(get);
  const valueTilt =
    giveValue + getValue > 0
      ? ((getValue - giveValue) / Math.max(giveValue, getValue, 1)) * 100
      : ((getWeekly - giveWeekly) / Math.max(giveWeekly, getWeekly, 0.01)) * 100;
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

      <BalanceMeter
        ready={ready}
        tilt={balanceTilt}
        giveValue={giveValue}
        getValue={getValue}
        giveWeekly={giveWeekly}
        getWeekly={getWeekly}
        fitPct={needDelta}
        valueOnly={valueOnly}
      />

      <section className="mt-4 rounded-xl border border-border bg-card p-4">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border-2 font-display text-3xl font-bold",
              !ready
                ? "border-border text-muted-foreground"
                : adjustedGrade.tone === "good"
                  ? "border-emerald-600 text-emerald-600"
                  : adjustedGrade.tone === "bad"
                    ? "border-destructive text-destructive"
                    : "border-border text-foreground",
            )}
          >
            {ready ? adjustedGrade.letter : "—"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Executive summary</p>
            <p className="mt-1 text-sm font-medium leading-snug text-foreground">{verdict}</p>
            {ready && (
              <>
                <p className="mt-1 text-xs text-muted-foreground">{fit.note}</p>
                <p className="tabnum mt-1 text-xs text-muted-foreground">
                  Production {basePct.toFixed(1)}% · Roster fit {needDelta > 0 ? "+" : ""}
                  {needDelta}% · Final {adjustedPct.toFixed(1)}%
                  {give.length !== get.length ? " · Consolidation modifier applied" : ""}
                </p>
              </>
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
            {constraint.shielded
              ? " Remaining bodies are locked as your only starter at their position, so no further drop is legal."
              : ""}
          </p>
        )}
        {ready && (
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="p-2">
              <b className="tabnum block text-sm">{giveWeekly.toFixed(1)}</b>Give pts/wk
            </div>
            <div className="p-2">
              <b className="tabnum block text-sm">{getWeekly.toFixed(1)}</b>Get pts/wk
            </div>
            <div className="p-2">
              <b
                className={cn(
                  "tabnum block text-sm",
                  needDelta > 0
                    ? "text-emerald-600"
                    : needDelta < 0
                      ? "text-destructive"
                      : undefined,
                )}
              >
                {needDelta > 0 ? "+" : ""}
                {needDelta}%
              </b>
              Roster fit
            </div>
          </div>
        )}

      </section>

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
function BalanceMeter({
  ready,
  tilt,
  giveValue,
  getValue,
  giveWeekly,
  getWeekly,
  fitPct,
  valueOnly,
}: {
  ready: boolean;
  tilt: number;
  giveValue: number;
  getValue: number;
  giveWeekly: number;
  getWeekly: number;
  fitPct: number;
  valueOnly: boolean;
}) {
  const clamped = Math.max(-100, Math.min(100, ready ? tilt : 0));
  const mag = Math.abs(clamped);
  const zone = mag <= FAIR_ZONE ? "fair" : mag <= 18 ? "warn" : "unfair";
  const left = 50 + clamped / 2;
  const barTone =
    zone === "fair"
      ? "bg-emerald-500"
      : zone === "warn"
        ? "bg-amber-500"
        : "bg-destructive";
  const textTone =
    zone === "fair"
      ? "text-emerald-600"
      : zone === "warn"
        ? "text-amber-600"
        : "text-destructive";

  return (
    <section className="mt-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-widest text-muted-foreground">
        <span>You give</span>
        <span className={cn("font-display", textTone)}>
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

      <div className="tabnum mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{giveValue > 0 ? giveValue.toLocaleString() : "—"}</span>
        <span className={cn("font-semibold", textTone)}>
          {ready ? `${clamped > 0 ? "+" : ""}${clamped.toFixed(1)}%` : "0.0%"}
        </span>
        <span>{getValue > 0 ? getValue.toLocaleString() : "—"}</span>
      </div>

      {ready && !valueOnly && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px] text-muted-foreground">
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
                fitPct > 0 ? "text-emerald-600" : fitPct < 0 ? "text-destructive" : "text-foreground",
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
  );
}
