import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Link2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DraftBoard } from "@/components/draft/DraftBoard";
import { MockRecap } from "@/components/draft/MockRecap";
import { PlayerList } from "@/components/draft/PlayerList";
import { PlayerModal } from "@/components/draft/PlayerModal";
import { RosterPanel } from "@/components/draft/RosterPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import {
  DEFAULT_ROSTER,
  DEFAULT_SETTINGS,
  positionNeeds,
  roundOf,
  rosterSize,
  teamForPick,
  teamName,
  SCORING_LABEL,
  type Pick as DraftPick,
  type Player,
  type Pos,
  type RosterSlots,
  type Scoring,
  type Settings,
} from "@/lib/draft";
import { getLeagueSync, getUserLeagues } from "@/lib/league.functions";
import type { LeagueSummary } from "@/lib/league.server";
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
  { label: "None", seconds: null },
];

const EMPTY_PAYLOAD = { season: "", updatedAt: 0, players: [] as Player[] };

type Config = {
  teamName: string;
  teams: number;
  slot: number;
  timerLabel: string;
  scoring: Scoring;
  roster: RosterSlots;
};

function MockDraftPage() {
  const navigate = useNavigate();
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
    scoring: DEFAULT_SETTINGS.scoring,
    roster: { ...DEFAULT_ROSTER },
  });

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [personas, setPersonas] = useState<Record<string, Personality>>({});
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [watch, setWatch] = useState<string[]>([]);
  const [customOrder, setCustomOrder] = useState<string[]>([]);
  const [speed, setSpeed] = useState<Speed>("normal");
  const [paused, setPaused] = useState(false);
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
    if (setupOpen || complete || myTurn || paused || speed === "manual" || !data.players.length)
      return;
    const id = setTimeout(() => runRef.current(), SPEED_DELAY[speed]);
    return () => clearTimeout(id);
  }, [setupOpen, complete, myTurn, paused, speed, picks.length, data.players.length]);

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

  const begin = () => {
    const roster = { ...config.roster };
    const rounds = Math.max(1, rosterSize(roster));
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
      roster,
      scoring: config.scoring,
      myTeam: slot,
      teamNames: names,
    });
    setPersonas(personaMap);
    setPicks([]);
    setRosterTeam(slot);
    setSpeed("normal");
    setPaused(false);
    setTab("players");
    setSetupOpen(false);
  };

  const restart = () => {
    setPicks([]);
    setPaused(false);
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
        onClose={() => navigate({ to: "/" })}
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
              [ {paused ? "Resume" : "Pause"} ]
            </button>
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
          <MockRecap settings={settings} picks={picks} byId={byId} />
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
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <header className="border-b border-border px-3 py-2">
                  <div className="font-display text-sm uppercase tracking-widest">My Team</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {teamName(settings, settings.myTeam)}
                  </div>
                </header>
                <RosterPanel
                  settings={settings}
                  picks={picks}
                  byId={byId}
                  team={settings.myTeam}
                />
              </div>
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

const ROSTER_FIELDS: { key: keyof RosterSlots; label: string }[] = [
  { key: "QB", label: "QB" },
  { key: "RB", label: "RB" },
  { key: "WR", label: "WR" },
  { key: "TE", label: "TE" },
  { key: "FLEX", label: "FLEX" },
  { key: "K", label: "K" },
  { key: "DEF", label: "DEF" },
  { key: "BENCH", label: "BENCH" },
];

const SCORING_CHOICES: { key: Scoring; label: string }[] = [
  { key: "std", label: "Standard" },
  { key: "ppr", label: "PPR" },
  { key: "half", label: "Half PPR" },
];

function SetupDialog({
  open,
  config,
  setConfig,
  onBegin,
  onClose,
}: {
  open: boolean;
  config: Config;
  setConfig: (c: Config) => void;
  onBegin: () => void;
  onClose: () => void;
}) {
  const [username, setUsername] = useState("");
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);

  const leaguesM = useMutation({
    mutationFn: (name: string) => getUserLeagues({ data: { username: name } }),
  });
  const syncM = useMutation({
    mutationFn: (vars: { leagueId: string }) => getLeagueSync({ data: vars }),
  });

  const slots = Array.from({ length: config.teams }, (_, i) => i + 1);

  const findLeagues = async () => {
    setSyncNote(null);
    setLeagues([]);
    const res = await leaguesM.mutateAsync(username.trim());
    if (!res.length) return setSyncNote("No leagues found for that Sleeper username.");
    if (res.length === 1) return applyLeague(res[0]!.id, res[0]!.name);
    setLeagues(res);
  };

  // League-wide settings only: scoring, roster slots and league size.
  // Team names are intentionally skipped so the sim generates its own.
  const applyLeague = async (leagueId: string, name: string) => {
    const res = await syncM.mutateAsync({ leagueId });
    if (!res) return setSyncNote("Couldn't load that league.");
    const teams = TEAM_CHOICES.includes(res.teams)
      ? res.teams
      : Math.min(16, Math.max(8, res.teams));
    setConfig({
      ...config,
      teams,
      slot: Math.min(config.slot, teams),
      scoring: res.scoring,
      roster: { ...config.roster, ...res.roster },
    });
    setLeagues([]);
    setSyncNote(`Imported settings from ${res.league.name || name} (team names skipped).`);
  };

  const busy = leaguesM.isPending || syncM.isPending;

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-h-[90vh] max-w-md overflow-y-auto"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close setup"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 grid size-6 place-items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl tracking-wide">Mock Draft Setup</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Sleeper league sync — settings only */}
          <div className="rounded-lg border border-border bg-card p-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full gap-2 font-display uppercase tracking-wide"
              onClick={() => setSyncOpen((v) => !v)}
            >
              <Link2 className="size-4" />
              Sleeper League Sync
            </Button>
            {syncOpen && (
              <div className="mt-3 space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={username}
                    placeholder="Sleeper username"
                    onChange={(e) => setUsername(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && username.trim() && void findLeagues()}
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || !username.trim()}
                    onClick={() => void findLeagues()}
                  >
                    {busy ? "…" : "Load"}
                  </Button>
                </div>
                {leagues.length > 0 && (
                  <ul className="space-y-1">
                    {leagues.map((l) => (
                      <li key={l.id}>
                        <button
                          type="button"
                          onClick={() => void applyLeague(l.id, l.name)}
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary"
                        >
                          <div className="truncate font-display">{l.name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {l.season} · {l.teams} teams · {l.scoring}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {syncNote ??
                    "Imports scoring, roster slots and league size only — team names stay local."}
                </p>
              </div>
            )}
          </div>

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
            <Label htmlFor="md-scoring">Scoring System</Label>
            <select
              id="md-scoring"
              value={config.scoring}
              onChange={(e) => setConfig({ ...config, scoring: e.target.value as Scoring })}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {SCORING_CHOICES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
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

          <div className="space-y-2 rounded-lg border border-border bg-card p-3">
            <Label className="font-display text-xs uppercase tracking-widest text-muted-foreground">
              Roster Positions Setup
            </Label>
            <div className="grid grid-cols-4 gap-2">
              {ROSTER_FIELDS.map((f) => (
                <div key={f.key} className="space-y-1">
                  <span className="block text-[10px] uppercase tracking-widest text-muted-foreground">
                    {f.label}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={12}
                    value={config.roster[f.key]}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        roster: {
                          ...config.roster,
                          [f.key]: Math.max(0, Math.min(12, Number(e.target.value) || 0)),
                        },
                      })
                    }
                    className="tabnum h-8 w-full rounded-md border border-input bg-background px-2 text-center text-sm"
                  />
                </div>
              ))}
            </div>
            <p className="tabnum text-[11px] text-muted-foreground">
              {rosterSize(config.roster)} rounds · {rosterSize(config.roster) * config.teams} total
              picks
            </p>
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
