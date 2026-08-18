import { useCallback, useEffect, useMemo, useState } from "react";

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

export function useDraft() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [watch, setWatch] = useState<string[]>([]);
  const [customOrder, setCustomOrder] = useState<string[]>([]);
  const [link, setLink] = useState<LeagueLink | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        if (parsed.settings) setSettings({ ...DEFAULT_SETTINGS, ...parsed.settings });
        if (Array.isArray(parsed.picks)) setPicks(parsed.picks);
        if (Array.isArray(parsed.watch)) setWatch(parsed.watch);
        if (Array.isArray(parsed.order)) setCustomOrder(parsed.order);
        if (parsed.link) setLink(parsed.link);
      }
    } catch {
      /* ignore corrupted state */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(
      KEY,
      JSON.stringify({ settings, picks, watch, order: customOrder, link } satisfies Persisted),
    );
  }, [settings, picks, watch, customOrder, link, hydrated]);

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
