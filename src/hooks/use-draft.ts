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
};

export function useDraft() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [watch, setWatch] = useState<string[]>([]);
  const [customOrder, setCustomOrder] = useState<string[]>([]);
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
      JSON.stringify({ settings, picks, watch, order: customOrder } satisfies Persisted),
    );
  }, [settings, picks, watch, customOrder, hydrated]);

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
    currentOverall,
    onTheClock,
    totalPicks,
    complete,
    hydrated,
  };
}
