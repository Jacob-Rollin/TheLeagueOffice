import { useHydrated } from "@tanstack/react-router";
import { useCallback, useSyncExternalStore } from "react";

/** Single global key shared by the homepage, War Room and Trade Analyzer. */
export const LEAGUE_LINK_KEY = "league-office-link-v1";
const EVENT = "league-link-change";

export type StoredLeagueLink = {
  username: string;
  leagueId: string;
  leagueName?: string;
  syncedAt?: string;
};

let cache: StoredLeagueLink | null = null;
let cacheRaw: string | null = null;

function read(): StoredLeagueLink | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEAGUE_LINK_KEY);
  } catch {
    return null;
  }
  if (raw === cacheRaw) return cache;
  cacheRaw = raw;
  try {
    cache = raw ? (JSON.parse(raw) as StoredLeagueLink) : null;
  } catch {
    cache = null;
  }
  return cache;
}

export const getLeagueLink = read;

export function saveLeagueLink(link: StoredLeagueLink) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LEAGUE_LINK_KEY, JSON.stringify(link));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Every browser storage key that holds Sleeper-derived data. Unlinking must
 * flush all of them so no page (War Room, Trade Desk, homepage) can restore
 * ghost team names from a stale cache.
 */
export const LEAGUE_CACHE_KEYS = [
  LEAGUE_LINK_KEY,
  "sleeper_username",
  "sleeper_league_id",
  "sleeper_rosters",
  "trade_page_teams",
];

export function clearLeagueLink() {
  if (typeof window === "undefined") return;
  cache = null;
  cacheRaw = null;
  try {
    for (const key of LEAGUE_CACHE_KEYS) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Subscribe to global link changes outside of React (module-level stores). */
export function onLeagueLinkChange(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Reactive access to the globally shared Sleeper league link. */
export function useLeagueLink() {
  // The first client render must match the server (null); localStorage is only
  // read after hydration, otherwise React throws hydration error #418.
  const hydrated = useHydrated();
  const stored = useSyncExternalStore(subscribe, read, () => null);
  const link = hydrated ? stored : null;
  const save = useCallback((next: StoredLeagueLink) => saveLeagueLink(next), []);
  const clear = useCallback(() => clearLeagueLink(), []);
  return { link, saveLink: save, clearLink: clear };
}

/** Display token for a synced platform, e.g. "Sleeper", "ESPN", "Yahoo". */
export function platformLabel(platform: string | null | undefined): string {
  const p = String(platform ?? "").toLowerCase();
  if (p === "espn") return "ESPN";
  if (p === "yahoo") return "Yahoo";
  if (p === "sleeper") return "Sleeper";
  return p ? p.toUpperCase() : "";
}
