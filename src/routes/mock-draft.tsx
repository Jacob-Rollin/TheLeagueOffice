import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ByeMatrix } from "@/components/draft/ByeMatrix";
import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { DraftBoard } from "@/components/draft/DraftBoard";
import { MyTeamColumn, SideCard } from "@/components/draft/MyTeamColumn";
import { MockRecap } from "@/components/draft/MockRecap";
import { PlayerList } from "@/components/draft/PlayerList";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import { RosterPanel } from "@/components/draft/RosterPanel";
import { Button } from "@/components/ui/button";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import {
  DEFAULT_SETTINGS,
  nextPicksFor,
  positionNeeds,
  roundOf,
  rosterSize,
  teamForPick,
  teamName,
  SCORING_LABEL,
  type Pick as DraftPick,
  type Player,
  type Pos,
  type Settings,
} from "@/lib/draft";
import {
  aiPick,
  autoPickForUser,
  generateOpponents,
  type Personality,
} from "@/lib/mock-ai";
import { loadMockConfig, timerSecondsFor, type MockConfig } from "@/lib/mock-config";
import { getPlayers } from "@/lib/players.functions";
import { cn } from "@/lib/utils";


const playersQuery = queryOptions({
  queryKey: ["players"],
  queryFn: () => getPlayers(),
  staleTime: 1000 * 60 * 30,
});

export const Route = createFileRoute("/mock-draft")({
  head: () => ({
    meta: [
      { title: "Mock Draft Simulator — The League Office" },
      {
        name: "description",
        content:
          "Run an AI-powered fantasy football mock draft with strategic computer managers, snake order, a live pick clock and full draft board.",
      },
      { property: "og:title", content: "Mock Draft Simulator — The League Office" },
      {
        property: "og:description",
        content:
          "Practice your draft against AI managers with Hero RB, Zero RB, Value Purist and streamer personalities.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MockDraftPage,
});

type Tab = "players" | "board" | "team";
type Speed = "normal" | "fast" | "manual";
const SPEED_DELAY: Record<Speed, number> = { normal: 5000, fast: 1000, manual: 0 };

const EMPTY_PAYLOAD = { season: "", updatedAt: 0, players: [] as Player[] };

function MockDraftPage() {
  const navigate = useNavigate();
  const cache = useSleeperPlayers();
  const fallback = useQuery({ ...playersQuery, enabled: Boolean(cache.error) && !cache.data });
  const data = cache.data ?? fallback.data ?? EMPTY_PAYLOAD;
  const syncing = !cache.data && (cache.loading || fallback.isLoading);

  const [config, setConfig] = useState<MockConfig | null>(null);
  const started = config !== null;

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [personas, setPersonas] = useState<Record<string, Personality>>({});
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [watch, setWatch] = useState<string[]>([]);
  const [customOrder, setCustomOrder] = useState<string[]>([]);
  const [speed, setSpeed] = useState<Speed>("normal");
  const [paused, setPaused] = useState(false);
  const [clock, setClock] = useState<number | null>(null);

  const modalRef = useRef<PlayerModalHandle>(null);
  const openPlayer = useCallback((id: string) => modalRef.current?.open(id), []);
  const [tab, setTab] = useState<Tab>("players");
  const [rosterTeam, setRosterTeam] = useState(1);

  const timerSeconds = config ? timerSecondsFor(config.timerLabel) : null;

  const byId = useMemo(
    () => new Map<string, Player>(data.players.map((p) => [p.id, p])),
    [data.players],
  );
  const draftedIds = useMemo(() => new Set(picks.map((p) => p.playerId)), [picks]);
  const watchIds = useMemo(() => new Set(watch), [watch]);

  const totalPicks = settings.teams * settings.rounds;
  const complete = picks.length >= totalPicks;
  const currentOverall = Math.min(picks.length + 1, totalPicks);
  const onTheClock = teamForPick(currentOverall, settings.teams, settings.snake);
  const myTurn = started && !complete && onTheClock === settings.myTeam;

  const rosters = useMemo(() => {
    const map = new Map<number, Player[]>();
    for (let t = 1; t <= settings.teams; t++) map.set(t, []);
    for (const p of picks) {
      const player = byId.get(p.playerId);
      if (player) map.get(p.team)?.push(player);
    }
    return map;
  }, [picks, byId, settings.teams]);

  const myPlayers = rosters.get(settings.myTeam) ?? [];
  const myNeeds = useMemo(
    () => positionNeeds(myPlayers, settings.roster) as Record<Pos, number>,
    [myPlayers, settings.roster],
  );
  const myCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of myPlayers) c[p.pos] = (c[p.pos] ?? 0) + 1;
    return c;
  }, [myPlayers]);

  const available = useMemo(
    () =>
      data.players
        .filter((p) => !draftedIds.has(p.id))
        .sort((a, b) => a.adp[settings.scoring] - b.adp[settings.scoring]),
    [data.players, draftedIds, settings.scoring],
  );

  const commitPick = useCallback((playerId: string, team: number) => {
    setPicks((prev) => {
      if (prev.some((p) => p.playerId === playerId)) return prev;
      return [...prev, { playerId, team, overall: prev.length + 1 }];
    });
  }, []);

  const draftForUser = useCallback(
    (playerId: string) => {
      if (!myTurn) return;
      commitPick(playerId, settings.myTeam);
    },
    [myTurn, commitPick, settings.myTeam],
  );

  const runAiPick = useCallback(() => {
    if (complete || !started) return;
    const team = teamForPick(picks.length + 1, settings.teams, settings.snake);
    if (team === settings.myTeam) return;
    const recentPos = picks
      .slice(-4)
      .map((p) => byId.get(p.playerId)?.pos)
      .filter((p): p is Pos => Boolean(p));
    const choice = aiPick(team, available, {
      settings,
      rosters,
      personas,
      recentPos,
      overall: picks.length + 1,
    });
    if (choice) commitPick(choice.id, team);
  }, [complete, started, picks, settings, byId, available, rosters, personas, commitPick]);

  // Simulation loop: computer slots pick automatically at the active speed.
  const runRef = useRef(runAiPick);
  runRef.current = runAiPick;
  useEffect(() => {
    if (!started || complete || myTurn || paused || speed === "manual" || !data.players.length)
      return;
    const id = setTimeout(() => runRef.current(), SPEED_DELAY[speed]);
    return () => clearTimeout(id);
  }, [started, complete, myTurn, paused, speed, picks.length, data.players.length]);

  // Pick clock: counts down only while the human is on the clock and unpaused.
  useEffect(() => {
    if (!myTurn || timerSeconds === null) {
      setClock(timerSeconds === null ? null : timerSeconds);
      return;
    }
    if (paused) return;
    const id = setInterval(() => {
      setClock((c) => (c === null ? null : Math.max(0, c - 1)));
    }, 1000);
    return () => clearInterval(id);
  }, [myTurn, timerSeconds, picks.length, paused]);

  // Reset the clock at the start of each of the user's turns.
  useEffect(() => {
    if (myTurn && timerSeconds !== null) setClock(timerSeconds);
  }, [myTurn, timerSeconds, picks.length]);

  // Auto-draft with the Suggested engine when the clock expires.
  useEffect(() => {
    if (!myTurn || paused || clock !== 0) return;
    const choice = autoPickForUser(available, myPlayers, settings, picks.length + 1);
    if (choice) commitPick(choice.id, settings.myTeam);
  }, [clock, myTurn, paused, available, myPlayers, settings, picks.length, commitPick]);

  // Boot the arena from the standalone /mock-draft/setup configuration.
  useEffect(() => {
    const stored = loadMockConfig();
    if (!stored) {
      navigate({ to: "/mock-draft/setup" });
      return;
    }
    const roster = { ...stored.roster };
    const rounds = Math.max(1, rosterSize(roster));
    const slot = Math.min(Math.max(1, stored.slot), stored.teams);
    const { names, personas: personaMap } = generateOpponents(
      stored.teams,
      slot,
      stored.teamName,
    );
    setSettings({
      ...DEFAULT_SETTINGS,
      teams: stored.teams,
      rounds,
      roster,
      scoring: stored.scoring,
      snake: stored.snake,
      myTeam: slot,
      teamNames: names,
    });
    setPersonas(personaMap);
    setPicks([]);
    setRosterTeam(slot);
    setSpeed("normal");
    setPaused(false);
    setTab("players");
    setConfig({ ...stored, slot });
  }, [navigate]);

  const toggleWatch = useCallback(
    (id: string) =>
      setWatch((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])),
    [],
  );
  const undoPick = useCallback(() => setPicks((prev) => prev.slice(0, -1)), []);

  const restart = () => {
    navigate({ to: "/mock-draft/setup" });
  };


  const mySlotLabel = `${roundOf(currentOverall, settings.teams)}.${(((currentOverall - 1) % settings.teams) + 1).toString().padStart(2, "0")}`;
  const lastPick = picks.length ? picks[picks.length - 1]! : null;
  const lastPlayer = lastPick ? byId.get(lastPick.playerId) : undefined;
  const myUpcoming = nextPicksFor(settings.myTeam, currentOverall, settings, 1);
  const untilMyPick = myUpcoming.length ? myUpcoming[0]! - currentOverall : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col">

      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 pt-3">
          <div>
            <h1 className="display-title text-3xl">
              Mock Draft <span className="text-primary">Simulator</span>
            </h1>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
              {data.season} · {SCORING_LABEL[settings.scoring]} · {settings.teams} teams ·{" "}
              {settings.rounds} rds · Slot {settings.myTeam}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={restart} className="font-display uppercase">
              New Mock
            </Button>
          </div>
        </div>

        {/* Persistent simulation toolbar */}
        <div className="mt-3 flex flex-wrap items-center gap-2 px-3">
          <span className="font-display text-[11px] uppercase tracking-widest text-muted-foreground">
            Sim Speed
          </span>
          <div className="flex overflow-hidden rounded-md border border-border">
            {(
              [
                ["normal", "Normal"],
                ["fast", "Fast"],
                ["manual", "Manual"],
              ] as [Speed, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSpeed(key)}
                className={cn(
                  "px-3 py-1.5 font-display text-xs uppercase tracking-wide transition-colors",
                  speed === key
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {speed === "manual" && !myTurn && !complete && (
            <Button size="sm" onClick={runAiPick} className="font-display uppercase">
              Advance Pick
            </Button>
          )}
          <div className="ml-auto flex items-center gap-3">
            {lastPlayer && lastPick && (
              <button
                onClick={() => openPlayer(lastPlayer.id)}
                className="hidden items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-left leading-tight transition-colors hover:border-primary sm:flex"
              >
                <PlayerAvatar
                  id={lastPlayer.id}
                  pos={lastPlayer.pos}
                  team={lastPlayer.team}
                  name={lastPlayer.name}
                  className="size-7"
                />
                <span className="min-w-0">
                  <span className="block text-[9px] uppercase tracking-widest text-muted-foreground">
                    Previous pick
                  </span>
                  <span className="block truncate text-[11px] font-semibold">{lastPlayer.name}</span>
                </span>
              </button>
            )}
            <span
              className={cn(
                "tabnum font-display text-sm uppercase tracking-widest",
                myTurn && clock !== null && clock <= 10 && !paused
                  ? "text-destructive"
                  : "text-foreground",
              )}
            >
              Time Remaining:{" "}
              {clock === null ? "--:--" : `${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`}
            </span>
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              disabled={complete}
              className={cn(
                "rounded-md border px-3 py-1.5 font-display text-xs uppercase tracking-wide transition-colors disabled:opacity-50",
                paused
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {paused ? "Resume" : "Pause"}
            </button>
          </div>

        </div>

        {myTurn && (
          <div className="mt-2 flex animate-pulse items-center justify-center gap-2 border-y border-accent bg-accent px-3 py-2 font-display text-sm uppercase tracking-[0.3em] text-accent-foreground">
            Your Turn — You are picking at {mySlotLabel}
          </div>
        )}

        {/* Draft board tracker ribbon — seamless double-track marquee */}
        <DraftTicker picks={picks} byId={byId} teams={settings.teams} />

        <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden border-y border-border bg-border">
          <Stat
            label="On the clock"
            value={complete ? "Done" : teamName(settings, onTheClock)}
            highlight={myTurn}
          />
          <Stat label="Pick" value={complete ? `${picks.length}` : mySlotLabel} />
          <Stat
            label="Your next"
            value={
              complete || untilMyPick === null
                ? "—"
                : untilMyPick === 0
                  ? "Your turn"
                  : `${untilMyPick} away`
            }
            highlight={myTurn}
          />
        </div>

        <nav className="flex gap-1 px-3 py-2">
          {(
            [
              ["players", complete ? "Post-Draft Recap" : "Available Players"],
              ["board", "Draft Board"],
              ["team", "Team Rosters"],
            ] as [Tab, string][]
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
        </nav>
      </header>

      <div className="flex-1 gap-3 px-0 py-3 lg:px-3">
        {tab === "players" && complete && (
          <MockRecap
            settings={settings}
            picks={picks}
            byId={byId}
            playoffsStartWeek={config?.playoffsStartWeek ?? 15}
          />
        )}
        {tab === "players" && !complete && syncing && (
          <div className="space-y-2 px-3 py-6">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Syncing player database…
            </p>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted/40" />
            ))}
          </div>
        )}
        {tab === "players" && !complete && !syncing && (
          <div className="md:grid md:grid-cols-[280px_minmax(0,1fr)] md:items-start md:gap-3">
            <aside className="hidden md:block md:min-w-[280px] md:shrink-0">
              <SideCard title="My Team" subtitle={teamName(settings, settings.myTeam)}>
                <MyTeamColumn
                  settings={settings}
                  players={myPlayers}
                  picks={picks}
                  onOpen={openPlayer}
                />
              </SideCard>
            </aside>
            <PlayerList
              players={data.players}
              draftedIds={draftedIds}
              watchIds={watchIds}
              counts={myCounts}
              needs={myNeeds}
              customOrder={customOrder}
              settings={settings}
              currentOverall={currentOverall}
              onDraft={draftForUser}
              onToggleWatch={toggleWatch}
              onReorder={setCustomOrder}
              onUndo={undoPick}
              canUndo={picks.length > 0}
              onOpenPlayer={openPlayer}
              canDraft={myTurn}
              hideValueTags
            />
          </div>
        )}

        {tab === "board" && <DraftBoard settings={settings} picks={picks} byId={byId} />}
        {tab === "team" && (
          <div className="px-3">
            <div className="mb-3 flex flex-wrap gap-1">
              {Array.from({ length: settings.teams }, (_, i) => i + 1).map((t) => (
                <button
                  key={t}
                  onClick={() => setRosterTeam(t)}
                  className={cn(
                    "rounded-md border px-2.5 py-1.5 font-display text-xs uppercase tracking-wide transition-colors",
                    rosterTeam === t
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {teamName(settings, t)}
                </button>
              ))}
            </div>
            <div className="md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] md:items-start md:gap-3">
              <div className="mb-3 rounded-xl border border-border bg-card p-3 md:mb-0">
                <div className="mb-2 font-display text-sm uppercase tracking-widest">
                  Bye Week Matrix
                </div>
                {(rosters.get(rosterTeam) ?? []).length ? (
                  <ByeMatrix players={rosters.get(rosterTeam) ?? []} layout="column" />
                ) : (
                  <p className="p-3 text-center text-xs text-muted-foreground">
                    No picks yet for this team.
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-border bg-card">
                <RosterPanel settings={settings} picks={picks} byId={byId} team={rosterTeam} />
              </div>
            </div>
          </div>
        )}
      </div>

      <PlayerModalHost ref={modalRef} />
    </main>
  );
}

const DraftTicker = memo(function DraftTicker({
  picks,
  byId,
  teams,
}: {
  picks: DraftPick[];
  byId: Map<string, Player>;
  teams: number;
}) {
  const all = useMemo(
    () =>
      picks.map((pk) => {
        const pl = byId.get(pk.playerId);
        return {
          key: pk.overall,
          label: `${roundOf(pk.overall, teams)}.${(((pk.overall - 1) % teams) + 1).toString().padStart(2, "0")}`,
          name: pl?.name ?? "—",
          meta: `${pl?.pos ? ` ${pl.pos}` : ""}${pl?.team ? `/${pl.team}` : ""}`,
        };
      }),
    [picks, byId, teams],
  );

  // The visible track only swaps in new picks at a loop boundary, so the crawl
  // never restarts or jumps mid-cycle when the picks array grows.
  const trackRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState(all);
  const pending = useRef(all);
  pending.current = all;

  useEffect(() => {
    setItems((cur) => (cur.length === 0 ? pending.current : cur));
    const el = trackRef.current;
    if (!el) return;
    const onIteration = () => setItems(pending.current);
    el.addEventListener("animationiteration", onIteration);
    return () => el.removeEventListener("animationiteration", onIteration);
  }, [all]);

  if (!items.length) {
    return (
      <div className="mt-2 border-y border-border bg-surface px-3 py-1.5">
        <span className="whitespace-nowrap font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          Board empty — waiting on pick 1.01
        </span>
      </div>
    );
  }

  // Duration scales with the track length so the crawl speed stays constant.
  const duration = `${Math.max(12, items.length * 2.6)}s`;

  return (
    <div className="no-scrollbar mt-2 overflow-hidden border-y border-border bg-surface py-1.5">
      <div ref={trackRef} className="ticker-track" style={{ animationDuration: duration }}>
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 items-center gap-4 pr-4" aria-hidden={copy === 1}>
            {items.map((it) => (
              <span
                key={`${copy}-${it.key}`}
                className="whitespace-nowrap font-mono text-[11px] uppercase tracking-wide"
              >
                <span className="tabnum text-muted-foreground">{it.label}</span>{" "}
                <span className="font-semibold">{it.name}</span>
                <span className="text-muted-foreground">{it.meta}</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn("bg-surface px-3 py-2", highlight && "bg-primary/15")}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div
        className={cn(
          "tabnum truncate font-display text-lg leading-tight font-semibold",
          highlight && "text-primary",
        )}
      >
        {value}
      </div>
    </div>
  );
}
