import { DEFAULT_ROSTER, DEFAULT_SETTINGS, type RosterSlots, type Scoring } from "@/lib/draft";

export type MockConfig = {
  teamName: string;
  teams: number;
  slot: number;
  timerLabel: string;
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
  { key: "K", label: "K" },
  { key: "DEF", label: "DEF" },
  { key: "BENCH", label: "BENCH" },
];

export const DEFAULT_MOCK_CONFIG: MockConfig = {
  teamName: "My Team",
  teams: 12,
  slot: 1,
  timerLabel: "60 Seconds",
  scoring: DEFAULT_SETTINGS.scoring,
  roster: { ...DEFAULT_ROSTER },
  snake: true,
  playoffsStartWeek: 15,
};

const KEY = "mock-draft-config-v1";

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
    return {
      ...DEFAULT_MOCK_CONFIG,
      ...parsed,
      roster: { ...DEFAULT_MOCK_CONFIG.roster, ...(parsed.roster ?? {}) },
    };
  } catch {
    return null;
  }
}

export function timerSecondsFor(label: string): number | null {
  return TIMER_CHOICES.find((t) => t.label === label)?.seconds ?? null;
}
