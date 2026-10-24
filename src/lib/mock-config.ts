import { DEFAULT_ROSTER, DEFAULT_SETTINGS, type RosterSlots, type Scoring } from "@/lib/draft";

/** AI opponent pick delay (not the user pick clock). */
export type DraftAiSpeed = "fast" | "normal" | "slow";

export type MockConfig = {
  teamName: string;
  teams: number;
  slot: number;
  timerLabel: string;
  /** Delay before each AI pick. */
  draftSpeed: DraftAiSpeed;
  scoring: Scoring;
  roster: RosterSlots;
  /** true = snake order, false = linear order. */
  snake: boolean;
  /** First week of the playoffs; the regular season runs to the week before. */
  playoffsStartWeek: number;
};

export const TEAM_CHOICES = [8, 10, 12, 14, 16];

export const TIMER_CHOICES: { label: string; seconds: number | null }[] = [
  { label: "None", seconds: null },
  { label: "30 Seconds", seconds: 30 },
  { label: "60 Seconds", seconds: 60 },
  { label: "90 Seconds", seconds: 90 },
  { label: "2 Minutes", seconds: 120 },
];

export const DRAFT_SPEED_CHOICES: {
  key: DraftAiSpeed;
  label: string;
  /** Seconds between AI picks. */
  seconds: number;
}[] = [
  { key: "fast", label: "Fast", seconds: 1 },
  { key: "normal", label: "Normal", seconds: 5 },
  { key: "slow", label: "Slow", seconds: 15 },
];

export const PLAYOFF_WEEKS = [14, 15, 16, 17];

export const SCORING_CHOICES: { key: Scoring; label: string }[] = [
  { key: "std", label: "Standard" },
  { key: "ppr", label: "PPR" },
  { key: "half", label: "Half PPR" },
];

export const ROSTER_FIELDS: { key: keyof RosterSlots; label: string }[] = [
  { key: "QB", label: "QB" },
  { key: "RB", label: "RB" },
  { key: "WR", label: "WR" },
  { key: "TE", label: "TE" },
  { key: "FLEX", label: "FLEX" },
  { key: "SUPER_FLEX", label: "SUPER FLEX" },
  { key: "K", label: "K" },
  { key: "DEF", label: "DST" },
  { key: "BENCH", label: "BENCH" },
];

export const DEFAULT_MOCK_CONFIG: MockConfig = {
  teamName: "My Team",
  teams: 12,
  slot: 1,
  timerLabel: "60 Seconds",
  draftSpeed: "normal",
  scoring: DEFAULT_SETTINGS.scoring,
  roster: { ...DEFAULT_ROSTER },
  snake: true,
  playoffsStartWeek: 15,
};

const KEY = "mock-draft-config-v1";
const SESSION_KEY = "mock-draft-session-v1";

export type MockSessionState = {
  config: MockConfig;
  picks: { playerId: string; team: number; overall: number }[];
  watch: string[];
  customOrder: string[];
  speed: DraftAiSpeed | "manual";
  paused: boolean;
  /** User ended early from the menu — treat as finished (recap / no more picks). */
  endedEarly?: boolean;
  tab: "players" | "board" | "team" | "queue";
  rosterTeam: number;
};

export function saveMockConfig(config: MockConfig) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(KEY, JSON.stringify(config));
}

export function loadMockConfig(): MockConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MockConfig>;
    const draftSpeed = normalizeDraftAiSpeed(parsed.draftSpeed);
    return {
      ...DEFAULT_MOCK_CONFIG,
      ...parsed,
      draftSpeed,
      roster: { ...DEFAULT_MOCK_CONFIG.roster, ...(parsed.roster ?? {}) },
    };
  } catch {
    return null;
  }
}

export function saveMockSession(state: MockSessionState) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota */
  }
}

export function loadMockSession(): MockSessionState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MockSessionState;
  } catch {
    return null;
  }
}

export function clearMockSession() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(SESSION_KEY);
}

/** True when the in-progress session belongs to the same setup config. */
export function mockSessionMatchesConfig(
  session: MockSessionState | null,
  config: MockConfig,
): boolean {
  if (!session?.config) return false;
  const a = session.config;
  return (
    a.teams === config.teams &&
    a.slot === config.slot &&
    a.scoring === config.scoring &&
    a.snake === config.snake &&
    a.teamName === config.teamName &&
    a.timerLabel === config.timerLabel &&
    a.playoffsStartWeek === config.playoffsStartWeek &&
    JSON.stringify(a.roster) === JSON.stringify({ ...DEFAULT_ROSTER, ...config.roster })
  );
}

export function timerSecondsFor(label: string): number | null {
  return TIMER_CHOICES.find((t) => t.label === label)?.seconds ?? null;
}

export function normalizeDraftAiSpeed(raw: unknown): DraftAiSpeed {
  if (raw === "fast" || raw === "normal" || raw === "slow") return raw;
  return "normal";
}

/** Milliseconds to wait before an AI opponent picks. */
export function draftAiSpeedDelayMs(speed: DraftAiSpeed | "manual"): number {
  if (speed === "manual") return 0;
  const secs = DRAFT_SPEED_CHOICES.find((c) => c.key === speed)?.seconds ?? 5;
  return secs * 1000;
}
