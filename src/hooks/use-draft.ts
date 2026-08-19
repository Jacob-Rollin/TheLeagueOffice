import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import {
  DEFAULT_SETTINGS,
  teamForPick,
  type Pick,
  type Settings,
} from "@/lib/draft";

const KEY = "ff-draft-state-v1";

type Persisted = {
  settings: Settings;
  picks: Pick[];
  watch?: string[];
  order?: string[];
  link?: LeagueLink | null;
};

export type LeagueLink = {
  leagueId: string;
  leagueName: string;
  username: string;
  syncedAt: string;
};

export type LeagueSyncInput = {
  teams: number;
  rounds: number;
  snake: boolean;
  scoring: Settings["scoring"];
  roster: Settings["roster"];
  teamNames: Record<string, string>;
  myTeam: number | null;
  picks: { playerId: string; team: number }[];
};

type StoreState = {
  settings: Settings;
  picks: Pick[];
  watch: string[];
  customOrder: string[];
  link: LeagueLink | null;
  hydrated: boolean;
};

let state: StoreState = {
  settings: DEFAULT_SETTINGS,
  picks: [],
  watch: [],
  customOrder: [],
  link: null,
  hydrated: false,
};

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function persist() {
  if (!state.hydrated) return;
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        settings: state.settings,
        picks: state.picks,
        watch: state.watch,
        order: state.customOrder,
        link: state.link,
      } satisfies Persisted),
    );
  } catch {
    /* ignore quota errors */
  }
}

function setState(patch: Partial<StoreState>) {
  state = { ...state, ...patch };
  persist();
  emit();
}

type Updater<T> = T | ((prev: T) => T);
function resolve<T>(next: Updater<T>, prev: T): T {
  return typeof next === "function" ? (next as (p: T) => T)(prev) : next;
}

let hydrating = false;
function hydrate() {
  if (state.hydrated || hydrating || typeof window === "undefined") return;
  hydrating = true;
  let loaded: Partial<StoreState> = {};
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Persisted;
      loaded = {
        ...(parsed.settings ? { settings: { ...DEFAULT_SETTINGS, ...parsed.settings } } : {}),
        ...(Array.isArray(parsed.picks) ? { picks: parsed.picks } : {}),
        ...(Array.isArray(parsed.watch) ? { watch: parsed.watch } : {}),
        ...(Array.isArray(parsed.order) ? { customOrder: parsed.order } : {}),
        ...(parsed.link ? { link: parsed.link } : {}),
      };
    }
  } catch {
    /* ignore corrupted state */
  }
  state = { ...state, ...loaded, hydrated: true };
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const SERVER_SNAPSHOT: StoreState = {
  settings: DEFAULT_SETTINGS,
  picks: [],
  watch: [],
  customOrder: [],
  link: null,
  hydrated: false,
};

export function useDraft() {
  const store = useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_SNAPSHOT,
  );

  useEffect(() => {
    hydrate();
  }, []);

  const { settings, picks, watch, customOrder, link, hydrated } = store;

  const setSettings = useCallback(
    (next: Updater<Settings>) => setState({ settings: resolve(next, state.settings) }),
    [],
  );
  const setPicks = useCallback(
    (next: Updater<Pick[]>) => setState({ picks: resolve(next, state.picks) }),
    [],
  );
  const setWatch = useCallback(
    (next: Updater<string[]>) => setState({ watch: resolve(next, state.watch) }),
    [],
  );
  const setCustomOrder = useCallback(
    (next: Updater<string[]>) => setState({ customOrder: resolve(next, state.customOrder) }),
    [],
  );
  const setLink = useCallback(
    (next: Updater<LeagueLink | null>) => setState({ link: resolve(next, state.link) }),
    [],
  );



  const totalPicks = settings.teams * settings.rounds;
  const currentOverall = Math.min(picks.length + 1, totalPicks);
  const onTheClock = teamForPick(currentOverall, settings.teams, settings.snake);
  const complete = picks.length >= totalPicks;

  const draftedIds = useMemo(() => new Set(picks.map((p) => p.playerId)), [picks]);
  const watchIds = useMemo(() => new Set(watch), [watch]);

  const draftPlayer = useCallback(
    (playerId: string) => {
      setPicks((prev) => {
        if (prev.length >= settings.teams * settings.rounds) return prev;
        if (prev.some((p) => p.playerId === playerId)) return prev;
        const overall = prev.length + 1;
        return [
          ...prev,
          { playerId, overall, team: teamForPick(overall, settings.teams, settings.snake) },
        ];
      });
    },
    [settings.teams, settings.rounds, settings.snake],
  );

  const toggleWatch = useCallback((playerId: string) => {
    setWatch((prev) =>
      prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId],
    );
  }, []);

  const undo = useCallback(() => setPicks((prev) => prev.slice(0, -1)), []);

  /** Remove a mis-clicked pick anywhere on the board and renumber the rest. */
  const removePick = useCallback(
    (playerId: string) => {
      setPicks((prev) =>
        prev
          .filter((p) => p.playerId !== playerId)
          .map((p, i) => ({
            playerId: p.playerId,
            overall: i + 1,
            team: teamForPick(i + 1, settings.teams, settings.snake),
          })),
      );
    },
    [settings.teams, settings.snake],
  );
  const reset = useCallback(() => setPicks([]), []);

  /** Overwrite settings + rosters from a linked Sleeper league. */
  const applyLeague = useCallback((sync: LeagueSyncInput, meta: LeagueLink) => {
    const teams = Math.max(2, sync.teams);
    const rounds = Math.max(1, sync.rounds);
    setSettings((prev) => ({
      ...prev,
      teams,
      rounds,
      snake: sync.snake,
      scoring: sync.scoring,
      roster: sync.roster,
      teamNames: sync.teamNames,
      myTeam: sync.myTeam && sync.myTeam <= teams ? sync.myTeam : Math.min(prev.myTeam, teams),
    }));

    // Rebuild the board: deal each team's rostered players out in draft order.
    const byTeam = new Map<number, string[]>();
    for (const p of sync.picks) {
      if (p.team < 1 || p.team > teams) continue;
      const list = byTeam.get(p.team) ?? [];
      list.push(p.playerId);
      byTeam.set(p.team, list);
    }
    const deepest = Math.max(0, ...[...byTeam.values()].map((l) => l.length));
    const next: Pick[] = [];
    const seen = new Set<string>();
    for (let round = 0; round < Math.min(deepest, rounds); round++) {
      for (let i = 0; i < teams; i++) {
        const team = sync.snake && round % 2 === 1 ? teams - i : i + 1;
        const playerId = byTeam.get(team)?.[round];
        if (!playerId || seen.has(playerId)) continue;
        seen.add(playerId);
        next.push({ playerId, team, overall: next.length + 1 });
      }
    }
    setPicks(next);
    setLink(meta);
  }, []);

  const unlinkLeague = useCallback(() => setLink(null), []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  return {
    settings,
    updateSettings,
    picks,
    draftedIds,
    draftPlayer,
    watchIds,
    toggleWatch,
    customOrder,
    setCustomOrder,
    undo,
    removePick,
    reset,
    link,
    applyLeague,
    unlinkLeague,
    currentOverall,
    onTheClock,
    totalPicks,
    complete,
    hydrated,
  };
}
