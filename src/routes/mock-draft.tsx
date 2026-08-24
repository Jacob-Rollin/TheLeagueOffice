import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DraftBoard } from "@/components/draft/DraftBoard";
import { PlayerList } from "@/components/draft/PlayerList";
import { PlayerModal } from "@/components/draft/PlayerModal";
import { RosterPanel } from "@/components/draft/RosterPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import {
  DEFAULT_SETTINGS,
  positionNeeds,
  roundOf,
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
  PERSONALITY_LABEL,
  type Personality,
} from "@/lib/mock-ai";
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

const TEAM_CHOICES = [8, 10, 12, 14, 16];
const TIMER_CHOICES: { label: string; seconds: number | null }[] = [
  { label: "30 Seconds", seconds: 30 },
  { label: "60 Seconds", seconds: 60 },
  { label: "90 Seconds", seconds: 90 },
  { label: "2 Minutes", seconds: 120 },
  { label: "Untimed", seconds: null },
];

const EMPTY_PAYLOAD = { season: "", updatedAt: 0, players: [] as Player[] };

type Config = {
  teamName: string;
  teams: number;
  slot: number;
  timerLabel: string;
};

function MockDraftPage() {
  const cache = useSleeperPlayers();
  const fallback = useQuery({ ...playersQuery, enabled: Boolean(cache.error) && !cache.data });
  const data = cache.data ?? fallback.data ?? EMPTY_PAYLOAD;
  const syncing = !cache.data && (cache.loading || fallback.isLoading);

  const [setupOpen, setSetupOpen] = useState(true);
  const [config, setConfig] = useState<Config>({
    teamName: "My Team",
    teams: 12,
    slot: 1,
    timerLabel: "60 Seconds",
  });

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [personas, setPersonas] = useState<Record<string, Personality>>({});
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [watch, setWatch] = useState<string[]>([]);
  const [customOrder, setCustomOrder] = useState<string[]>([]);
  const [speed, setSpeed] = useState<Speed>("normal");
  const [clock, setClock] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("players");
  const [rosterTeam, setRosterTeam] = useState(1);

  const timerSeconds =
    TIMER_CHOICES.find((t) => t.label === config.timerLabel)?.seconds ?? null;

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
  const myTurn = !setupOpen && !complete && onTheClock === settings.myTeam;

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
    if (complete || setupOpen) return;
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
  }, [complete, setupOpen, picks, settings, byId, available, rosters, personas, commitPick]);

  // Simulation loop: computer slots pick automatically at the active speed.
  const runRef = useRef(runAiPick);
  runRef.current = runAiPick;
  useEffect(() => {
    if (setupOpen || complete || myTurn || speed === "manual" || !data.players.length) return;
    const id = setTimeout(() => runRef.current(), SPEED_DELAY[speed]);
    return () => clearTimeout(id);
  }, [setupOpen, complete, myTurn, speed, picks.length, data.players.length]);

  // Pick clock: counts down only while the human is on the clock.
  useEffect(() => {
    if (!myTurn || timerSeconds === null) {
      setClock(timerSeconds === null ? null : timerSeconds);
      return;
    }
    setClock(timerSeconds);
    const id = setInterval(() => {
      setClock((c) => (c === null ? null : Math.max(0, c - 1)));
    }, 1000);
    return () => clearInterval(id);
  }, [myTurn, timerSeconds, picks.length]);

  // Auto-draft with the Suggested engine when the clock expires.
  useEffect(() => {
    if (!myTurn || clock !== 0) return;
    const choice = autoPickForUser(available, myPlayers, settings, picks.length + 1);
    if (choice) commitPick(choice.id, settings.myTeam);
  }, [clock, myTurn, available, myPlayers, settings, picks.length, commitPick]);

  const begin = () => {
    const rounds = DEFAULT_SETTINGS.rounds;
    const slot = Math.min(Math.max(1, config.slot), config.teams);
    const { names, personas: personaMap } = generateOpponents(
      config.teams,
      slot,
      config.teamName,
    );
    setSettings({
      ...DEFAULT_SETTINGS,
      teams: config.teams,
      rounds,
      myTeam: slot,
      teamNames: names,
    });
    setPersonas(personaMap);
    setPicks([]);
    setRosterTeam(slot);
    setSpeed("normal");
    setSetupOpen(false);
  };

  const restart = () => {
    setPicks([]);
    setSetupOpen(true);
  };

  const lastPick = picks.length ? picks[picks.length - 1]! : null;
  const lastPlayer = lastPick ? byId.get(lastPick.playerId) : undefined;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col">
      <SetupDialog
        open={setupOpen}
        config={config}
        setConfig={setConfig}
        onBegin={begin}
      />

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
            <span
              className={cn(
                "tabnum font-display text-sm uppercase tracking-widest",
                myTurn && clock !== null && clock <= 10 ? "text-destructive" : "text-foreground",
              )}
            >
              Time Remaining:{" "}
              {clock === null ? "--:--" : `${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`}
            </span>
          </div>
        </div>

        {myTurn && (
          <div className="mt-2 flex items-center justify-center gap-2 border-y border-accent bg-accent px-3 py-2 font-display text-sm uppercase tracking-[0.3em] text-accent-foreground">
            Your Turn
          </div>
        )}

        <div className="mt-3 grid grid-cols-4 gap-px overflow-hidden border-y border-border bg-border">
          <Stat
            label="On the clock"
            value={complete ? "Done" : teamName(settings, onTheClock)}
            highlight={myTurn}
          />
          <Stat
            label="Pick"
            value={`PICK ${roundOf(currentOverall, settings.teams)}.${(((currentOverall - 1) % settings.teams) + 1)
              .toString()
              .padStart(2, "0")}`}
          />
          <Stat
            label="Strategy"
            value={
              onTheClock === settings.myTeam
                ? "You"
                : (PERSONALITY_LABEL[personas[String(onTheClock)] ?? "value"] ?? "—")
            }
          />
          <Stat
            label="Last pick"
            value={lastPlayer ? lastPlayer.name : "—"}
          />
        </div>

        <nav className="flex gap-1 px-3 py-2">
          {(
            [
              ["players", "Available Players"],
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
        {tab === "players" && syncing && (
          <div className="space-y-2 px-3 py-6">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Syncing player database…
            </p>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted/40" />
            ))}
          </div>
        )}
        {tab === "players" && !syncing && (
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
            onToggleWatch={(id) =>
              setWatch((prev) =>
                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
              )
            }
            onReorder={setCustomOrder}
            onUndo={() => setPicks((prev) => prev.slice(0, -1))}
            canUndo={picks.length > 0}
            onOpenPlayer={setOpenId}
            canDraft={myTurn}
          />
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
            <div className="rounded-xl border border-border bg-card">
              <RosterPanel settings={settings} picks={picks} byId={byId} team={rosterTeam} />
            </div>
          </div>
        )}
      </div>

      <PlayerModal id={openId} onClose={() => setOpenId(null)} onSelectPlayer={setOpenId} />
    </main>
  );
}

function SetupDialog({
  open,
  config,
  setConfig,
  onBegin,
}: {
  open: boolean;
  config: Config;
  setConfig: (c: Config) => void;
  onBegin: () => void;
}) {
  const slots = Array.from({ length: config.teams }, (_, i) => i + 1);
  return (
    <Dialog open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="display-title text-2xl">Mock Draft Setup</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="md-team">Team Name</Label>
            <Input
              id="md-team"
              value={config.teamName}
              onChange={(e) => setConfig({ ...config, teamName: e.target.value })}
              placeholder="Your team name"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Amount of Teams</Label>
            <div className="flex gap-1">
              {TEAM_CHOICES.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() =>
                    setConfig({ ...config, teams: n, slot: Math.min(config.slot, n) })
                  }
                  className={cn(
                    "flex-1 rounded-md border px-2 py-1.5 font-display text-sm transition-colors",
                    config.teams === n
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="md-slot">Draft Slot Position</Label>
            <select
              id="md-slot"
              value={config.slot}
              onChange={(e) => setConfig({ ...config, slot: Number(e.target.value) })}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {slots.map((s) => (
                <option key={s} value={s}>
                  Slot {s}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Slots available: 1–{config.teams}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="md-timer">Pick Timer</Label>
            <select
              id="md-timer"
              value={config.timerLabel}
              onChange={(e) => setConfig({ ...config, timerLabel: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {TIMER_CHOICES.map((t) => (
                <option key={t.label} value={t.label}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <Button className="w-full font-display uppercase tracking-wide" onClick={onBegin}>
            Begin Mock Draft
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

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
