import { queryOptions, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { usePageVisible } from "@/lib/page-visibility";
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
  draftAiSpeedDelayMs,
  normalizeDraftAiSpeed,
  timerSecondsFor,
  type DraftAiSpeed,
  type MockConfig,
  type MockSessionState,
} from "@/lib/mock-config";
import { playMockDraftSound } from "@/lib/mock-draft-sounds";
import { loadPlayersCatalog } from "@/lib/players-catalog";

/** Warn once when the pick clock enters this window (seconds). */
const TURN_WARNING_AT = 10;

export type MockDraftTab = "players" | "queue" | "team";
export type MockDraftSpeed = DraftAiSpeed | "manual";

const EMPTY_PAYLOAD = { season: "", updatedAt: 0, players: [] as Player[] };

const playersQuery = queryOptions({
  queryKey: ["players-catalog"],
  queryFn: () => loadPlayersCatalog(),
  staleTime: 1000 * 60 * 30,
});

export type UseMockDraftSessionOptions = {
  /** When config is missing, called once so the host can seed defaults / redirect. */
  onMissingConfig: () => void;
  /** When on, draft the top available queued player on the user's turn. */
  queueAutopick?: boolean;
  /**
   * Bump to re-read sessionStorage config and restart the board (e.g. after
   * mid-draft settings save) without a full document reload.
   */
  bootKey?: number;
  /**
   * When false, AI + pick clock stay frozen (lobby / pre-start). Resume in-progress
   * sessions should pass true once picks exist.
   */
  live?: boolean;
};

/** Shared solo mock-draft engine (AI opponents, clock, sessionStorage). */
export function useMockDraftSession({
  onMissingConfig,
  queueAutopick = false,
  bootKey = 0,
  live = true,
}: UseMockDraftSessionOptions) {
  const pageVisible = usePageVisible();
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
  const myTurn = live && started && !complete && onTheClock === settings.myTeam;

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

  // Drop anyone drafted by any team (AI or user) so the queue stays available-only.
  useEffect(() => {
    setWatch((prev) => {
      const next = prev.filter((id) => !draftedIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [draftedIds]);

  const picksRef = useRef(picks);
  picksRef.current = picks;

  const commitPick = useCallback(
    (playerId: string, team: number) => {
      if (picksRef.current.some((p) => p.playerId === playerId)) return;
      playMockDraftSound(team === settings.myTeam ? "pick-locked" : "ai-pick-locked");
      setPicks((prev) => {
        if (prev.some((p) => p.playerId === playerId)) return prev;
        return [...prev, { playerId, team, overall: prev.length + 1 }];
      });
      setWatch((prev) => prev.filter((id) => id !== playerId));
    },
    [settings.myTeam],
  );

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
  // Pause AI when lobby / user pause / tab hidden — avoids background CPU and
  // accidental autopicks while the visitor is elsewhere.
  useEffect(() => {
    if (
      !live ||
      !started ||
      complete ||
      myTurn ||
      paused ||
      !pageVisible ||
      speed === "manual" ||
      !data.players.length
    ) {
      return;
    }
    const id = setTimeout(() => runRef.current(), draftAiSpeedDelayMs(speed));
    return () => clearTimeout(id);
  }, [
    live,
    started,
    complete,
    myTurn,
    paused,
    pageVisible,
    speed,
    picks.length,
    data.players.length,
  ]);

  // Pick clock runs for every team (AI + user), Sleeper-style — not only on
  // the user's turn. Auto-pick / queue still only fire when `myTurn`.
  useEffect(() => {
    if (!live || complete || timerSeconds === null) {
      setClock(null);
      return;
    }
    if (paused || !pageVisible) return;
    const id = setInterval(() => {
      setClock((c) => (c === null ? null : Math.max(0, c - 1)));
    }, 1000);
    return () => clearInterval(id);
  }, [live, complete, timerSeconds, picks.length, paused, pageVisible]);

  useEffect(() => {
    if (live && !complete && timerSeconds !== null) setClock(timerSeconds);
  }, [live, complete, timerSeconds, picks.length]);

  // Queue auto-pick: on the user's turn, draft rank #1 (still available) quickly.
  useEffect(() => {
    if (!live || !myTurn || paused || !pageVisible || complete) return;
    if (!queueAutopickOn) return;
    const top = queuedPlayers[0];
    if (!top) return;
    const id = window.setTimeout(() => {
      commitPick(top.id, settings.myTeam);
    }, 350);
    return () => window.clearTimeout(id);
  }, [
    live,
    myTurn,
    paused,
    pageVisible,
    complete,
    queueAutopickOn,
    queuedPlayers,
    settings.myTeam,
    commitPick,
  ]);

  // Cue sounds for turn start / low clock / draft end. Resume mid-draft skips the
  // initial "your turn" blast; a fresh start on the clock still cues once.
  const soundPrimedRef = useRef(false);
  const prevMyTurnRef = useRef(false);
  const prevCompleteRef = useRef(false);
  const warnedForPickRef = useRef<number | null>(null);
  const expiredForPickRef = useRef<number | null>(null);

  useEffect(() => {
    soundPrimedRef.current = false;
    warnedForPickRef.current = null;
    expiredForPickRef.current = null;
    if (!live) {
      prevMyTurnRef.current = myTurn;
      prevCompleteRef.current = complete;
      return;
    }
    const pickCount = picks.length;
    const id = window.setTimeout(() => {
      soundPrimedRef.current = true;
      if (myTurn && !complete && pickCount === 0) {
        playMockDraftSound("your-turn");
      }
      prevMyTurnRef.current = myTurn;
      prevCompleteRef.current = complete;
    }, 0);
    return () => window.clearTimeout(id);
  }, [live, bootKey]);

  // Clock expiry: needs-based pick when queue autopick is off or the queue is empty.
  useEffect(() => {
    if (!live || !myTurn || paused || !pageVisible || clock !== 0) return;
    if (expiredForPickRef.current === picks.length) return;
    expiredForPickRef.current = picks.length;
    playMockDraftSound("clock-expired");
    if (queueAutopickOn && queuedPlayers[0]) return;
    const choice = autoPickForUser(available, myPlayers, settings, picks.length + 1);
    if (choice) commitPick(choice.id, settings.myTeam);
  }, [
    live,
    clock,
    myTurn,
    paused,
    pageVisible,
    queueAutopickOn,
    queuedPlayers,
    available,
    myPlayers,
    settings,
    picks.length,
    commitPick,
  ]);

  useEffect(() => {
    if (!live || !soundPrimedRef.current) return;
    if (myTurn && !prevMyTurnRef.current && !complete) {
      playMockDraftSound("your-turn");
    }
    prevMyTurnRef.current = myTurn;
  }, [live, myTurn, complete]);

  useEffect(() => {
    if (!live || !soundPrimedRef.current) return;
    if (complete && !prevCompleteRef.current) {
      playMockDraftSound("draft-complete");
    }
    prevCompleteRef.current = complete;
  }, [live, complete]);

  useEffect(() => {
    if (!live || !myTurn || paused || !pageVisible || complete) return;
    if (clock === null || clock > TURN_WARNING_AT || clock <= 0) return;
    if (warnedForPickRef.current === picks.length) return;
    warnedForPickRef.current = picks.length;
    playMockDraftSound("turn-warning");
  }, [live, myTurn, paused, pageVisible, complete, clock, picks.length]);

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
      setSpeed(
        session.speed === "manual"
          ? "manual"
          : normalizeDraftAiSpeed(session.speed ?? nextConfig.draftSpeed),
      );
      setPaused(Boolean(session.paused));
      const restoredTab = session.tab === "board" ? "players" : (session.tab as MockDraftTab) || "players";
      setTab(restoredTab === "queue" || restoredTab === "team" ? restoredTab : "players");
      setRosterTeam(session.rosterTeam || slot);
    } else {
      setPicks([]);
      setWatch([]);
      setCustomOrder([]);
      setRosterTeam(slot);
      setSpeed(normalizeDraftAiSpeed(nextConfig.draftSpeed));
      setPaused(false);
      setTab("players");
      clearMockSession();
    }
    setConfig(nextConfig);
  }, [bootKey]);

  // Debounce session writes so rapid tab swaps / picks don't hitch the UI.
  useEffect(() => {
    if (!config || !started) return;
    const payload: MockSessionState = {
      config,
      picks,
      watch,
      customOrder,
      speed,
      paused,
      tab,
      rosterTeam,
    };
    const id = window.setTimeout(() => saveMockSession(payload), 120);
    return () => window.clearTimeout(id);
  }, [config, started, picks, watch, customOrder, speed, paused, tab, rosterTeam]);

  const watchRef = useRef(watch);
  watchRef.current = watch;

  const toggleWatch = useCallback((id: string) => {
    const prev = watchRef.current;
    if (prev.includes(id)) {
      playMockDraftSound("queue-remove");
      setWatch(prev.filter((x) => x !== id));
    } else {
      playMockDraftSound("queue-add");
      setWatch([...prev, id]);
    }
  }, []);

  /** Move a queued player up (-1) or down (+1) in autopick priority. */
  const moveQueued = useCallback((id: string, dir: -1 | 1) => {
    setWatch((prev) => {
      const i = prev.indexOf(id);
      if (i < 0) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      const a = next[i]!;
      next[i] = next[j]!;
      next[j] = a;
      return next;
    });
  }, []);

  const removeQueued = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const drop = new Set(ids);
    const prev = watchRef.current;
    const next = prev.filter((id) => !drop.has(id));
    if (next.length === prev.length) return;
    playMockDraftSound("queue-remove");
    setWatch(next);
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
    moveQueued,
    removeQueued,
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
