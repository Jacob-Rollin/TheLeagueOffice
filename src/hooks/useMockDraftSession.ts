import { queryOptions, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import {
  DEFAULT_SETTINGS,
  nextPicksFor,
  positionNeeds,
  roundOf,
  rosterSize,
  teamForPick,
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
import {
  clearMockSession,
  loadMockConfig,
  loadMockSession,
  mockSessionMatchesConfig,
  saveMockSession,
  timerSecondsFor,
  type MockConfig,
  type MockSessionState,
} from "@/lib/mock-config";
import { loadPlayersCatalog } from "@/lib/players-catalog";

export type MockDraftTab = "players" | "queue" | "team";
export type MockDraftSpeed = "normal" | "fast" | "manual";

const SPEED_DELAY: Record<MockDraftSpeed, number> = {
  normal: 5000,
  fast: 1000,
  manual: 0,
};

const EMPTY_PAYLOAD = { season: "", updatedAt: 0, players: [] as Player[] };

const playersQuery = queryOptions({
  queryKey: ["players-catalog"],
  queryFn: () => loadPlayersCatalog(),
  staleTime: 1000 * 60 * 30,
});

export type UseMockDraftSessionOptions = {
  /** When config is missing, called once so the host can redirect to setup. */
  onMissingConfig: () => void;
  /** Prefer queue order when the pick clock expires (mobile auto-pick toggle). */
  queueAutopick?: boolean;
};

/** Shared solo mock-draft engine (AI opponents, clock, sessionStorage). */
export function useMockDraftSession({
  onMissingConfig,
  queueAutopick = false,
}: UseMockDraftSessionOptions) {
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
  const [speed, setSpeed] = useState<MockDraftSpeed>("normal");
  const [paused, setPaused] = useState(false);
  const [clock, setClock] = useState<number | null>(null);
  const [tab, setTab] = useState<MockDraftTab>("players");
  const [rosterTeam, setRosterTeam] = useState(1);
  const [queueAutopickOn, setQueueAutopickOn] = useState(queueAutopick);

  const timerSeconds = config ? timerSecondsFor(config.timerLabel) : null;
  const onMissingRef = useRef(onMissingConfig);
  onMissingRef.current = onMissingConfig;

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

  const queuedPlayers = useMemo(
    () =>
      watch
        .map((id) => byId.get(id))
        .filter((p): p is Player => p != null && !draftedIds.has(p.id)),
    [watch, byId, draftedIds],
  );

  const commitPick = useCallback((playerId: string, team: number) => {
    setPicks((prev) => {
      if (prev.some((p) => p.playerId === playerId)) return prev;
      return [...prev, { playerId, team, overall: prev.length + 1 }];
    });
    setWatch((prev) => prev.filter((id) => id !== playerId));
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

  const runRef = useRef(runAiPick);
  runRef.current = runAiPick;
  useEffect(() => {
    if (!started || complete || myTurn || paused || speed === "manual" || !data.players.length)
      return;
    const id = setTimeout(() => runRef.current(), SPEED_DELAY[speed]);
    return () => clearTimeout(id);
  }, [started, complete, myTurn, paused, speed, picks.length, data.players.length]);

  useEffect(() => {
    if (!myTurn || timerSeconds === null) {
      setClock(null);
      return;
    }
    if (paused) return;
    const id = setInterval(() => {
      setClock((c) => (c === null ? null : Math.max(0, c - 1)));
    }, 1000);
    return () => clearInterval(id);
  }, [myTurn, timerSeconds, picks.length, paused]);

  useEffect(() => {
    if (myTurn && timerSeconds !== null) setClock(timerSeconds);
  }, [myTurn, timerSeconds, picks.length]);

  useEffect(() => {
    if (!myTurn || paused || clock !== 0) return;
    let choice: Player | null = null;
    if (queueAutopickOn) {
      choice = queuedPlayers[0] ?? null;
    }
    if (!choice) {
      choice = autoPickForUser(available, myPlayers, settings, picks.length + 1);
    }
    if (choice) commitPick(choice.id, settings.myTeam);
  }, [
    clock,
    myTurn,
    paused,
    queueAutopickOn,
    queuedPlayers,
    available,
    myPlayers,
    settings,
    picks.length,
    commitPick,
  ]);

  useEffect(() => {
    const stored = loadMockConfig();
    if (!stored) {
      onMissingRef.current();
      return;
    }
    const roster = { ...DEFAULT_SETTINGS.roster, ...stored.roster };
    const rounds = Math.max(1, rosterSize(roster));
    const slot = Math.min(Math.max(1, stored.slot), stored.teams);
    const nextConfig = { ...stored, slot, roster };
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

    const session = loadMockSession();
    if (mockSessionMatchesConfig(session, nextConfig) && session && session.picks.length > 0) {
      setPicks(session.picks);
      setWatch(session.watch ?? []);
      setCustomOrder(session.customOrder ?? []);
      setSpeed(session.speed ?? "normal");
      setPaused(Boolean(session.paused));
      const restoredTab = session.tab === "board" ? "players" : (session.tab as MockDraftTab) || "players";
      setTab(restoredTab === "queue" || restoredTab === "team" ? restoredTab : "players");
      setRosterTeam(session.rosterTeam || slot);
    } else {
      setPicks([]);
      setWatch([]);
      setCustomOrder([]);
      setRosterTeam(slot);
      setSpeed("normal");
      setPaused(false);
      setTab("players");
      clearMockSession();
    }
    setConfig(nextConfig);
  }, []);

  useEffect(() => {
    if (!config || !started) return;
    const payload: MockSessionState = {
      config,
      picks,
      watch,
      customOrder,
      speed,
      paused,
      tab: tab === "queue" ? "players" : tab,
      rosterTeam,
    };
    saveMockSession(payload);
  }, [config, started, picks, watch, customOrder, speed, paused, tab, rosterTeam]);

  const toggleWatch = useCallback((id: string) => {
    setWatch((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const undoPick = useCallback(() => setPicks((prev) => prev.slice(0, -1)), []);

  const myUpcoming = nextPicksFor(settings.myTeam, currentOverall, settings, 1);
  const untilMyPick = myUpcoming.length ? myUpcoming[0]! - currentOverall : null;
  const mySlotLabel = `${roundOf(currentOverall, settings.teams)}.${(((currentOverall - 1) % settings.teams) + 1).toString().padStart(2, "0")}`;
  const nextUserOverall = myUpcoming[0] ?? null;

  return {
    data,
    syncing,
    config,
    started,
    settings,
    personas,
    picks,
    watch,
    watchIds,
    customOrder,
    setCustomOrder,
    speed,
    setSpeed,
    paused,
    setPaused,
    clock,
    tab,
    setTab,
    rosterTeam,
    setRosterTeam,
    queueAutopickOn,
    setQueueAutopickOn,
    byId,
    draftedIds,
    available,
    queuedPlayers,
    myPlayers,
    myNeeds,
    myCounts,
    rosters,
    complete,
    currentOverall,
    onTheClock,
    myTurn,
    totalPicks,
    mySlotLabel,
    untilMyPick,
    nextUserOverall,
    draftForUser,
    runAiPick,
    toggleWatch,
    undoPick,
    clearSession: clearMockSession,
  };
}

export function formatClock(seconds: number | null): string {
  if (seconds === null) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
