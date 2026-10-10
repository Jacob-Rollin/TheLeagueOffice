import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import { AccessGate } from "@/components/league/AccessGate";
import { ActiveLeagueLabel } from "@/components/league/ActiveLeagueLabel";
import { TlonCrawl, type TlonCrawlItem } from "@/components/tlon/TlonCrawl";
import { TlonMatchupPicker, type TlonMatchupOption } from "@/components/tlon/TlonMatchupPicker";
import { TlonPlayCard } from "@/components/tlon/TlonPlayCard";
import { TlonScorebug, type TlonDaypart } from "@/components/tlon/TlonScorebug";
import {
  TlonChaseMeter,
  TlonStudio,
  type TlonStudioPlayer,
} from "@/components/tlon/TlonStudio";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { useActiveMatchups } from "@/hooks/useActiveMatchups";
import { useActiveStandings } from "@/hooks/useActiveStandings";
import { useLeagueProjections, useNflState } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useNflGameProgress } from "@/hooks/useNflGameProgress";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { useWeeklyActualStats } from "@/hooks/useWeeklyActualStats";
import type { Player } from "@/lib/draft";
import {
  computeMatchupPreview,
  matchupSlotLabels,
  matchupWeeklyFallback,
  resolveMatchupStarters,
} from "@/lib/matchup-preview";
import {
  computeTeamDisplayProjection,
  type NflGameProgress,
} from "@/lib/rolling-live-projection";
import { fetchSnapFantasyNews, fetchSnapInjuryWire } from "@/lib/snap-cdn";
import {
  diffStarterPoints,
  mergeFeedEvents,
  snapshotsToMap,
  type TlonFeedEvent,
  type TlonStarterSnapshot,
} from "@/lib/tlon-play-feed";
import { visibleRefetchInterval } from "@/lib/page-visibility";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tlon")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "The League Network — The League Office" },
      {
        name: "description",
        content: "Watch your fantasy matchup live on The League Network — scorebug, scoring feed, and studio boards.",
      },
    ],
  }),
  component: TlonPage,
});

function progressForTeam(
  map: Map<string, NflGameProgress>,
  team: string | null | undefined,
): NflGameProgress | undefined {
  const nfl = (team || "").trim().toUpperCase();
  if (!nfl) return undefined;
  if (map.has(nfl)) return map.get(nfl);
  if (nfl === "WSH") return map.get("WAS");
  if (nfl === "WAS") return map.get("WSH") ?? map.get("WAS");
  if (nfl === "LA") return map.get("LAR");
  if (nfl === "LAR") return map.get("LAR") ?? map.get("LA");
  if (nfl === "JAC") return map.get("JAX");
  if (nfl === "JAX") return map.get("JAX") ?? map.get("JAC");
  return undefined;
}

function gameLabel(progress?: NflGameProgress | null): string | null {
  if (!progress) return null;
  if (progress.phase === "post") return progress.boxScoreLabel || "Final";
  if (progress.phase === "pre") return progress.shortDetail || "Pregame";
  const q = progress.period != null ? (progress.period > 4 ? "OT" : `${progress.period}Q`) : "";
  const clock = progress.displayClock || "";
  return [q, clock].filter(Boolean).join(" ") || null;
}

function formatRecord(wins: number, losses: number, ties: number): string {
  if (ties > 0) return `${wins}-${losses}-${ties}`;
  return `${wins}-${losses}`;
}

function TlonPage() {
  const { ready, user } = useAuth();
  const { activeLeague, activeLeagueId, leagues } = useActiveLeague();

  if (!ready) {
    return (
      <main className="mx-auto w-full max-w-shell px-3 pb-16 pt-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto w-full max-w-shell px-0 pb-16 pt-0 sm:px-0">
        <AccessGate
          kind="guest"
          product="TLN"
          headline="Watch your matchup like a network broadcast"
          description="Sign up and sync a league to open The League Network — live scorebug, scoring feed, and studio boards for your H2H."
        />
      </main>
    );
  }

  if (!activeLeague) {
    return (
      <main className="mx-auto w-full max-w-shell px-0 pb-16 pt-0 sm:px-0">
        <AccessGate
          kind="sync"
          product="TLN"
          headline={
            leagues.length === 0
              ? "Sync a league to go on air"
              : "Select a synced league to continue"
          }
          description={
            leagues.length === 0
              ? "Connect Sleeper or ESPN so The League Network can track your weekly matchup live."
              : "Choose an active league from Account to load your matchup network."
          }
          syncTo={leagues.length === 0 ? "/leaguesync" : "/account/leagues"}
          syncLabel={leagues.length === 0 ? "Sync Your League" : "Manage My Leagues"}
        />
      </main>
    );
  }

  return <TlonNetwork key={activeLeagueId ?? "none"} />;
}

function TlonNetwork() {
  const { activeLeague, activeLeagueId } = useActiveLeague();
  const { data: playersPayload } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const { teams, myTeam, rosterPositions, loading: rostersLoading } = useLeagueRosters(players);
  const { standings } = useActiveStandings();
  const nflWeek = useNflState();
  const activeWeek = nflWeek.data?.week ?? 1;
  const { projectFor } = useLeagueProjections(activeWeek);
  const { matchups, loading: matchupsLoading } = useActiveMatchups(activeWeek);
  const { progressByNflTeam } = useNflGameProgress(activeWeek);
  const { statsFor } = useWeeklyActualStats(activeWeek);
  const modalRef = useRef<PlayerModalHandle>(null);
  const openPlayer = (id: string) => modalRef.current?.open(id);

  const [viewMatchupId, setViewMatchupId] = useState<string | null>(null);
  const [feed, setFeed] = useState<TlonFeedEvent[]>([]);
  const [winHistory, setWinHistory] = useState<number[]>([]);
  const prevSnapshots = useRef<Map<string, TlonStarterSnapshot> | null>(null);
  const feedMatchupKey = useRef<string>("");
  const lastWinSample = useRef<number | null>(null);

  const myRosterId = myTeam?.slot ?? teams.find((t) => t.isMine)?.slot ?? null;
  const platform = activeLeague?.platform ?? null;

  const matchupOptions = useMemo((): TlonMatchupOption[] => {
    const entries = matchups?.entries ?? [];
    const byId = new Map<number, typeof entries>();
    for (const entry of entries) {
      if (entry.matchupId == null) continue;
      const bucket = byId.get(entry.matchupId) ?? [];
      bucket.push(entry);
      byId.set(entry.matchupId, bucket);
    }

    const resolveName = (rosterId: number, fallback: string) =>
      teams.find((t) => Number(t.slot) === Number(rosterId))?.team?.trim() || fallback;
    const resolveLogo = (rosterId: number, fallback: string | null | undefined) =>
      teams.find((t) => Number(t.slot) === Number(rosterId))?.logo ?? fallback ?? null;

    const options: TlonMatchupOption[] = [];
    for (const [matchupId, pair] of byId) {
      const sorted = [...pair].sort((a, b) => {
        if (myRosterId != null && Number(a.rosterId) === Number(myRosterId)) return -1;
        if (myRosterId != null && Number(b.rosterId) === Number(myRosterId)) return 1;
        return Number(a.rosterId) - Number(b.rosterId);
      });
      const left = sorted[0];
      if (!left) continue;
      const right = sorted[1] ?? null;
      const leftName = resolveName(left.rosterId, left.teamName);
      const rightName = right ? resolveName(right.rosterId, right.teamName) : "Bye week";
      const isMine =
        myRosterId != null &&
        (Number(left.rosterId) === Number(myRosterId) ||
          (right != null && Number(right.rosterId) === Number(myRosterId)));
      options.push({
        id: String(matchupId),
        label: right ? `${leftName} vs ${rightName}` : `${leftName} (Bye)`,
        isMine,
        leftName,
        rightName,
        leftLogo: resolveLogo(left.rosterId, left.logo),
        rightLogo: right ? resolveLogo(right.rosterId, right.logo) : null,
        leftLive: left.points,
        rightLive: right?.points ?? 0,
      });
    }

    options.sort((a, b) => {
      if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    return options;
  }, [matchups, teams, myRosterId]);

  useEffect(() => {
    setViewMatchupId(null);
    setFeed([]);
    setWinHistory([]);
    prevSnapshots.current = null;
    feedMatchupKey.current = "";
    lastWinSample.current = null;
  }, [activeLeagueId, activeWeek]);

  useEffect(() => {
    if (!matchupOptions.length) return;
    if (viewMatchupId && matchupOptions.some((o) => o.id === viewMatchupId)) return;
    const mine = matchupOptions.find((o) => o.isMine);
    setViewMatchupId(mine?.id ?? matchupOptions[0]!.id);
  }, [matchupOptions, viewMatchupId]);

  const selected =
    matchupOptions.find((o) => o.id === viewMatchupId) ??
    matchupOptions.find((o) => o.isMine) ??
    matchupOptions[0] ??
    null;

  const pair = useMemo(() => {
    type Entry = NonNullable<typeof matchups>["entries"][number];
    const empty = {
      leftEntry: null as Entry | null,
      rightEntry: null as Entry | null,
      leftTeam: null as (typeof teams)[number] | null,
      rightTeam: null as (typeof teams)[number] | null,
    };
    if (!selected || !matchups?.entries?.length) return empty;
    const matchupId = Number(selected.id);
    const bucket = matchups.entries.filter((e) => e.matchupId === matchupId);
    const sorted = [...bucket].sort((a, b) => {
      if (myRosterId != null && Number(a.rosterId) === Number(myRosterId)) return -1;
      if (myRosterId != null && Number(b.rosterId) === Number(myRosterId)) return 1;
      return Number(a.rosterId) - Number(b.rosterId);
    });
    const left = sorted[0] ?? null;
    const right = sorted[1] ?? null;
    return {
      leftEntry: left,
      rightEntry: right,
      leftTeam: left
        ? teams.find((t) => Number(t.slot) === Number(left.rosterId)) ?? null
        : null,
      rightTeam: right
        ? teams.find((t) => Number(t.slot) === Number(right.rosterId)) ?? null
        : null,
    };
  }, [selected, matchups, teams, myRosterId]);

  const labels = useMemo(() => matchupSlotLabels(rosterPositions), [rosterPositions]);

  const leftStarters = useMemo(() => {
    if (!pair.leftEntry) return [] as Player[];
    return resolveMatchupStarters(
      pair.leftTeam,
      labels,
      pair.leftEntry.starters ?? [],
      playersById,
      pair.leftEntry.starterNames ?? [],
    );
  }, [pair, labels, playersById]);

  const rightStarters = useMemo(() => {
    if (!pair.rightEntry) return [] as Player[];
    return resolveMatchupStarters(
      pair.rightTeam,
      labels,
      pair.rightEntry.starters ?? [],
      playersById,
      pair.rightEntry.starterNames ?? [],
    );
  }, [pair, labels, playersById]);

  const leftPoints = pair.leftEntry?.playerPoints ?? {};
  const rightPoints = pair.rightEntry?.playerPoints ?? {};

  const preview = useMemo(() => {
    if (!pair.leftEntry) return null;
    return computeMatchupPreview({
      mine: {
        team: pair.leftTeam,
        points: pair.leftEntry.points,
        starterIds: pair.leftEntry.starters ?? [],
        starterNames: pair.leftEntry.starterNames ?? [],
        playerPoints: leftPoints,
      },
      opp: {
        team: pair.rightTeam,
        points: pair.rightEntry?.points ?? 0,
        starterIds: pair.rightEntry?.starters ?? [],
        starterNames: pair.rightEntry?.starterNames ?? [],
        playerPoints: rightPoints,
      },
      rosterPositions,
      playersById,
      projectFor,
      progressByNflTeam,
      activeWeek,
    });
  }, [
    pair,
    leftPoints,
    rightPoints,
    rosterPositions,
    playersById,
    projectFor,
    progressByNflTeam,
    activeWeek,
  ]);

  const sumStarterLive = (starters: Player[], map: Record<string, number>) =>
    Math.round(starters.reduce((s, p) => s + (Number(map[p.id] ?? 0) || 0), 0) * 10) / 10;

  const leftLive = sumStarterLive(leftStarters, leftPoints);
  const rightLive = sumStarterLive(rightStarters, rightPoints);

  const leftProj = useMemo(
    () =>
      computeTeamDisplayProjection({
        starters: leftStarters,
        playerPoints: leftPoints,
        projectFor,
        weeklyFallback: matchupWeeklyFallback,
        progressByNflTeam,
        teamLivePoints: leftLive,
        teamBaselineProj: pair.leftEntry?.projectedPoints ?? preview?.myOrigProj ?? 0,
      }),
    [leftStarters, leftPoints, projectFor, progressByNflTeam, leftLive, pair.leftEntry, preview],
  );

  const rightProj = useMemo(
    () =>
      computeTeamDisplayProjection({
        starters: rightStarters,
        playerPoints: rightPoints,
        projectFor,
        weeklyFallback: matchupWeeklyFallback,
        progressByNflTeam,
        teamLivePoints: rightLive,
        teamBaselineProj: pair.rightEntry?.projectedPoints ?? preview?.oppOrigProj ?? 0,
      }),
    [rightStarters, rightPoints, projectFor, progressByNflTeam, rightLive, pair.rightEntry, preview],
  );

  const winPctLeft = preview?.myWinPct ?? 50;
  const winPctRight = preview?.oppWinPct ?? 50;

  useEffect(() => {
    if (!selected) return;
    const sample = Math.round(winPctLeft);
    if (lastWinSample.current === sample) return;
    lastWinSample.current = sample;
    setWinHistory((prev) => {
      const next = [...prev, sample];
      return next.length > 48 ? next.slice(-48) : next;
    });
  }, [selected?.id, winPctLeft]);

  const starterSnapshots = useMemo((): TlonStarterSnapshot[] => {
    const rows: TlonStarterSnapshot[] = [];
    for (const p of leftStarters) {
      const progress = progressForTeam(progressByNflTeam, p.team);
      rows.push({
        playerId: p.id,
        playerName: p.name,
        pos: p.pos,
        team: p.team || "",
        side: "left",
        points: Number(leftPoints[p.id] ?? 0) || 0,
        stats: statsFor(p.id),
        gameLabel: gameLabel(progress),
      });
    }
    for (const p of rightStarters) {
      const progress = progressForTeam(progressByNflTeam, p.team);
      rows.push({
        playerId: p.id,
        playerName: p.name,
        pos: p.pos,
        team: p.team || "",
        side: "right",
        points: Number(rightPoints[p.id] ?? 0) || 0,
        stats: statsFor(p.id),
        gameLabel: gameLabel(progress),
      });
    }
    return rows;
  }, [leftStarters, rightStarters, leftPoints, rightPoints, progressByNflTeam, statsFor]);

  useEffect(() => {
    const key = `${activeLeagueId ?? ""}:${activeWeek}:${selected?.id ?? ""}`;
    if (feedMatchupKey.current !== key) {
      feedMatchupKey.current = key;
      prevSnapshots.current = snapshotsToMap(starterSnapshots);
      setFeed([]);
      setWinHistory([]);
      lastWinSample.current = null;
      return;
    }
    if (!starterSnapshots.length) return;
    const incoming = diffStarterPoints(prevSnapshots.current, starterSnapshots);
    prevSnapshots.current = snapshotsToMap(starterSnapshots);
    if (incoming.length) setFeed((prev) => mergeFeedEvents(prev, incoming));
  }, [starterSnapshots, activeLeagueId, activeWeek, selected?.id]);

  const studioBuckets = useMemo(() => {
    const toRow = (p: Player, side: "left" | "right", map: Record<string, number>): TlonStudioPlayer => ({
      id: p.id,
      name: p.name,
      pos: p.pos,
      team: p.team || "",
      side,
      livePoints: Number(map[p.id] ?? 0) || 0,
      progress: progressForTeam(progressByNflTeam, p.team) ?? null,
    });
    const all = [
      ...leftStarters.map((p) => toRow(p, "left", leftPoints)),
      ...rightStarters.map((p) => toRow(p, "right", rightPoints)),
    ];
    const onClock = all.filter((r) => r.progress?.phase === "in");
    const comingUp = all
      .filter((r) => !r.progress || r.progress.phase === "pre")
      .sort((a, b) => {
        const atA = a.progress?.kickoffIso ? Date.parse(a.progress.kickoffIso) : Number.MAX_SAFE_INTEGER;
        const atB = b.progress?.kickoffIso ? Date.parse(b.progress.kickoffIso) : Number.MAX_SAFE_INTEGER;
        return atA - atB;
      });
    const locked = all.filter((r) => r.progress?.phase === "post");
    return { onClock, comingUp, locked };
  }, [leftStarters, rightStarters, leftPoints, rightPoints, progressByNflTeam]);

  const yetToPlay = (starters: Player[]) =>
    starters.filter((p) => {
      const phase = progressForTeam(progressByNflTeam, p.team)?.phase;
      return !phase || phase === "pre";
    }).length;

  const daypart: TlonDaypart = useMemo(() => {
    if (preview?.matchupFinal) return "FINAL";
    const anyIn = [...leftStarters, ...rightStarters].some(
      (p) => progressForTeam(progressByNflTeam, p.team)?.phase === "in",
    );
    if (anyIn || leftLive > 0.05 || rightLive > 0.05) return "LIVE";
    return "PRE";
  }, [preview, leftStarters, rightStarters, progressByNflTeam, leftLive, rightLive]);

  const leadingSide: "left" | "right" | "tie" =
    Math.abs(leftLive - rightLive) < 0.05
      ? winPctLeft === winPctRight
        ? "tie"
        : winPctLeft > winPctRight
          ? "left"
          : "right"
      : leftLive > rightLive
        ? "left"
        : "right";

  const recordFor = (rosterId: number | null | undefined): string | null => {
    if (rosterId == null) return null;
    const row = standings?.rows?.find((r) => Number(r.rosterId) === Number(rosterId));
    if (!row) return null;
    return formatRecord(row.wins, row.losses, row.ties ?? 0);
  };

  const rosterPlayerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of leftStarters) ids.add(p.id);
    for (const p of rightStarters) ids.add(p.id);
    for (const id of pair.leftEntry?.playerIds ?? []) if (id) ids.add(id);
    for (const id of pair.rightEntry?.playerIds ?? []) if (id) ids.add(id);
    return ids;
  }, [leftStarters, rightStarters, pair]);

  const crawlQuery = useQuery({
    queryKey: ["tlon-crawl", activeLeagueId, activeWeek, selected?.id ?? "none"],
    enabled: Boolean(activeLeague && selected),
    staleTime: 5 * 60 * 1000,
    refetchInterval: visibleRefetchInterval(10 * 60 * 1000),
    refetchIntervalInBackground: false,
    retry: false,
    queryFn: async (): Promise<TlonCrawlItem[]> => {
      const [wire, news] = await Promise.all([
        fetchSnapInjuryWire(40).catch(() => []),
        fetchSnapFantasyNews(60).catch(() => []),
      ]);
      const items: TlonCrawlItem[] = [];
      for (const w of wire ?? []) {
        if (w.sleeperId && rosterPlayerIds.has(w.sleeperId)) {
          items.push({
            id: `inj-${w.id}`,
            kind: "injury",
            text: `${w.playerName}: ${w.headline || w.status}`,
          });
        }
      }
      for (const n of news ?? []) {
        const pid = n.player?.id;
        if (pid && rosterPlayerIds.has(pid)) {
          items.push({
            id: `news-${n.id}`,
            kind: "news",
            text: n.headline,
          });
        }
      }
      return items.slice(0, 24);
    },
  });

  // Re-run crawl filter when roster ids settle without refetching snaps every time —
  // RQ key already includes matchup; placeholder keeps prior crawl.
  const crawlItems = crawlQuery.data ?? [];

  const leftName =
    pair.leftTeam?.team?.trim() ||
    pair.leftEntry?.teamName ||
    selected?.leftName ||
    "Team";
  const rightName =
    pair.rightTeam?.team?.trim() ||
    pair.rightEntry?.teamName ||
    selected?.rightName ||
    "Opponent";

  const leftLabel = selected?.isMine && Number(pair.leftEntry?.rosterId) === Number(myRosterId)
    ? "YOU"
    : leftName.slice(0, 8).toUpperCase();
  const rightLabel =
    selected?.isMine && Number(pair.rightEntry?.rosterId) === Number(myRosterId)
      ? "YOU"
      : selected?.isMine
        ? "OPP"
        : rightName.slice(0, 8).toUpperCase();

  const boardLoading =
    (matchupsLoading || rostersLoading || nflWeek.isLoading) && !matchups?.entries?.length;

  return (
    <main className="mx-auto w-full max-w-shell px-3 pb-16 pt-6">
      <PlayerModalHost ref={modalRef} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                daypart === "LIVE"
                  ? "bg-rose-600 text-white"
                  : daypart === "FINAL"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-200 text-slate-700",
              )}
            >
              {daypart === "LIVE" ? "On Air" : daypart}
            </span>
            <ActiveLeagueLabel />
          </div>
          <h1 className="display-title text-3xl text-slate-900">
            The League <span className="text-primary">Network</span>
          </h1>
          <p className="mt-1 max-w-xl text-sm text-slate-600">
            Watch this week&apos;s H2H like a broadcast — live scorebug, scoring feed, and studio boards.
          </p>
        </div>
        <Link
          to="/playbook/matchup"
          className="rounded-md border border-blue-600 bg-white px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50"
        >
          Open full Matchup
        </Link>
      </div>

      <div className="mt-6 space-y-4">
        {boardLoading ? (
          <p className="text-sm text-muted-foreground">Loading matchup network…</p>
        ) : !selected ? (
          <p className="text-sm text-muted-foreground">No matchups available for this week yet.</p>
        ) : (
          <>
            <div className="rounded-2xl bg-gradient-to-b from-slate-800 to-slate-950 px-3 py-8 sm:px-6">
              <TlonScorebug
                week={activeWeek}
                daypart={daypart}
                leftName={leftName}
                leftLogo={pair.leftTeam?.logo ?? pair.leftEntry?.logo ?? null}
                leftRecord={recordFor(pair.leftEntry?.rosterId)}
                leftLive={leftLive}
                leftYetToPlay={yetToPlay(leftStarters)}
                leftYetToPlayMax={leftStarters.length}
                rightName={rightName}
                rightLogo={pair.rightTeam?.logo ?? pair.rightEntry?.logo ?? null}
                rightRecord={recordFor(pair.rightEntry?.rosterId)}
                rightLive={rightLive}
                rightYetToPlay={yetToPlay(rightStarters)}
                rightYetToPlayMax={rightStarters.length}
                winPctLeft={winPctLeft}
                winPctRight={winPctRight}
                projTotal={leftProj + rightProj}
                liveTotal={leftLive + rightLive}
                platform={platform ?? null}
                leagueKey={activeLeagueId ?? null}
                leadingSide={leadingSide}
              />
            </div>

            <TlonMatchupPicker
              options={matchupOptions}
              selectedId={selected.id}
              onSelect={setViewMatchupId}
              platform={platform}
              leagueKey={activeLeagueId}
            />

            <TlonCrawl items={crawlItems} />

            <TlonChaseMeter
              leftLive={leftLive}
              rightLive={rightLive}
              leftProj={leftProj}
              rightProj={rightProj}
              leftName={leftName}
              rightName={rightName}
              winHistory={winHistory}
            />

            <TlonStudio
              onClock={studioBuckets.onClock}
              comingUp={studioBuckets.comingUp}
              locked={studioBuckets.locked}
              leftLabel={leftLabel}
              rightLabel={rightLabel}
              onOpenPlayer={openPlayer}
            />

            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <header className="flex items-center justify-between border-b border-slate-100 px-3 py-2 sm:px-4">
                <h2 className="display-title text-base text-slate-900">Live Scoring Feed</h2>
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  Updates ~30s
                </span>
              </header>
              <div className="space-y-2 p-3 sm:p-4">
                {feed.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">
                    Waiting for the next scoring move from starters in this matchup…
                  </p>
                ) : (
                  feed.map((event) => (
                    <TlonPlayCard
                      key={event.id}
                      event={event}
                      leftLabel={leftLabel}
                      rightLabel={rightLabel}
                      onOpenPlayer={openPlayer}
                    />
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
