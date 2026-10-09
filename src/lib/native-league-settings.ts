/**
 * Shared native-league settings shape + defaults (client-safe).
 * Persisted as columns + JSON on TiDB `native_leagues` (see native-league-ddl.server.ts).
 * Scoring uses Sleeper-keyed maps — same philosophy as scoring-map.ts / SCORING_GROUPS.
 */

import { emptyRoster, type RosterSlotKey } from "@/lib/league-settings";

export const NATIVE_SCORING_PRESETS = ["std", "half", "ppr", "custom"] as const;
export type NativeScoringPreset = (typeof NATIVE_SCORING_PRESETS)[number];

export const NATIVE_WAIVER_TYPES = ["rolling", "reverse", "faab"] as const;
export type NativeWaiverType = (typeof NATIVE_WAIVER_TYPES)[number];

export const NATIVE_DRAFT_MODES = ["offline", "live", "auto"] as const;
export type NativeDraftMode = (typeof NATIVE_DRAFT_MODES)[number];

export const NATIVE_DRAFT_FORMATS = ["standard", "salary_cap"] as const;
export type NativeDraftFormat = (typeof NATIVE_DRAFT_FORMATS)[number];

export const NATIVE_DRAFT_ORDER_TYPES = ["snake", "linear"] as const;
export type NativeDraftOrderType = (typeof NATIVE_DRAFT_ORDER_TYPES)[number];

export const NATIVE_PLAYOFF_LENGTHS = ["one", "two_all", "two_championship"] as const;
export type NativePlayoffMatchupLength = (typeof NATIVE_PLAYOFF_LENGTHS)[number];

export const NATIVE_STANDINGS_TIEBREAKERS = ["points_for", "head_to_head", "division"] as const;
export type NativeStandingsTiebreaker = (typeof NATIVE_STANDINGS_TIEBREAKERS)[number];

export const NATIVE_ROSTER_LOCK_TYPES = ["game_time", "first_game"] as const;
export type NativeRosterLockType = (typeof NATIVE_ROSTER_LOCK_TYPES)[number];

export const NATIVE_TRADE_VETO_MODES = ["none", "commissioner"] as const;
export type NativeTradeVetoMode = (typeof NATIVE_TRADE_VETO_MODES)[number];

export const NATIVE_POST_DRAFT_PLAYER_STATUS = ["free_agents", "follow_waiver_rules"] as const;
export type NativePostDraftPlayerStatus = (typeof NATIVE_POST_DRAFT_PLAYER_STATUS)[number];

export const NATIVE_MATCHUP_TIEBREAKER_SLOTS = ["Bench", "QB", "RB", "WR", "TE", "K", "DEF"] as const;
export type NativeMatchupTiebreakerSlot = (typeof NATIVE_MATCHUP_TIEBREAKER_SLOTS)[number];

/**
 * Commissioner-selectable designations allowed in IR slots.
 * Questionable / Doubtful / Out are never options.
 * Default is IR-only.
 */
export const NATIVE_IR_ALLOWED_STATUS_OPTIONS = ["IR", "NA", "Suspended"] as const;
export type NativeIrAllowedStatus = (typeof NATIVE_IR_ALLOWED_STATUS_OPTIONS)[number];

export const DEFAULT_IR_ALLOWED_STATUSES: NativeIrAllowedStatus[] = ["IR"];

/** Short labels for commissioner IR allow-list checkboxes. */
export const NATIVE_IR_ALLOWED_STATUS_LABELS: Record<NativeIrAllowedStatus, string> = {
  IR: "IR (Injured Reserve)",
  NA: "NA (Not Active)",
  Suspended: "Suspended",
};

const IR_ALLOWED_STATUSES_KEY = "irAllowedStatuses";
/** @deprecated legacy key — migrated by parseIrAllowedStatuses */
const IR_ELIGIBILITY_KEY = "irEligibility";

export function normalizeIrAllowedStatuses(
  input: unknown,
): NativeIrAllowedStatus[] {
  const fromArray = Array.isArray(input)
    ? input
        .map((v) => String(v))
        .filter((v): v is NativeIrAllowedStatus =>
          (NATIVE_IR_ALLOWED_STATUS_OPTIONS as readonly string[]).includes(v),
        )
    : [];
  const unique = [...new Set(fromArray)];
  return unique.length > 0 ? unique : [...DEFAULT_IR_ALLOWED_STATUSES];
}

/** Read IR allow-list from roster_slots JSON (with legacy irEligibility fallback). */
export function parseIrAllowedStatuses(
  raw: Record<string, unknown> | null | undefined,
): NativeIrAllowedStatus[] {
  if (!raw || typeof raw !== "object") return [...DEFAULT_IR_ALLOWED_STATUSES];
  if (Array.isArray(raw[IR_ALLOWED_STATUSES_KEY])) {
    return normalizeIrAllowedStatuses(raw[IR_ALLOWED_STATUSES_KEY]);
  }
  // Legacy: "any" → all selectable tags; "injured_only" → IR only (new stricter default).
  const legacy = raw[IR_ELIGIBILITY_KEY];
  if (legacy === "any") return [...NATIVE_IR_ALLOWED_STATUS_OPTIONS];
  return [...DEFAULT_IR_ALLOWED_STATUSES];
}

/** @deprecated use parseIrAllowedStatuses */
export function parseIrEligibility(
  raw: Record<string, unknown> | null | undefined,
): "injured_only" | "any" {
  const allowed = parseIrAllowedStatuses(raw);
  return allowed.length >= NATIVE_IR_ALLOWED_STATUS_OPTIONS.length ? "any" : "injured_only";
}

/** @deprecated */
export type NativeIrEligibility = "injured_only" | "any";

/** Merge slot counts + IR allow-list into the JSON blob on native_leagues.roster_slots. */
export function packRosterSlotsJson(
  slots: Partial<Record<RosterSlotKey, number>>,
  irAllowedStatuses: readonly NativeIrAllowedStatus[] = DEFAULT_IR_ALLOWED_STATUSES,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(slots) as RosterSlotKey[]) {
    const n = Math.floor(Number(slots[key] ?? 0));
    if (Number.isFinite(n) && n > 0) out[key] = n;
  }
  out[IR_ALLOWED_STATUSES_KEY] = normalizeIrAllowedStatuses(irAllowedStatuses);
  return out;
}

/** v1 product caps from the native leagues plan. */
export const NATIVE_LEAGUE_MIN_TEAMS = 4;
export const NATIVE_LEAGUE_MAX_TEAMS = 20;
export const NATIVE_MAX_COMMISSIONER_LEAGUES = 3;

/** Snapshot used by mobile/desktop Commissioner Tools (client-safe). */
export type NativeCommissionerSettings = {
  name: string;
  inviteCode: string;
  leagueId: string;
  seasonYear: number;
  teamCount: number;
  seasonStartWeek: number;
  isPublic: boolean;
  autoActivateNextYear: boolean;
  scoringPreset: string;
  scoringSettings: Record<string, number>;
  playoffTeams: number;
  playoffMatchupLength: string;
  playoffWeekPair: string;
  standingsTiebreaker: string;
  allowMatchupTies: boolean;
  matchupTiebreakerSlot: string;
  divisionsEnabled: boolean;
  waiverType: string;
  waiverBudget: number | null;
  waiverPeriodDays: number;
  postDraftPlayerStatus: string;
  lockFaOnGametime: boolean;
  maxAddsPerWeek: number | null;
  maxAddsPerSeason: number | null;
  undroppableTopPlayers: boolean;
  rosterLockType: string;
  tradeDeadlineWeek: number | null;
  tradeReviewHours: number;
  tradeVetoMode: string;
  maxTradesPerSeason: number | null;
  draftMode: string;
  draftFormat: string;
  draftOrderType: string;
  draftPickTimeLimitSec: number;
  keepersPerTeam: number;
  keeperNote: string | null;
  rosterSlots: Record<string, number>;
  irAllowedStatuses: NativeIrAllowedStatus[];
  rosterCapacity: number;
  settingsLocked: boolean;
  canManage: boolean;
  /**
   * When true, commissioner may assign AI managers to open seats.
   * Used for native-league testing; AI ticks run via Actions cron (not page load).
   */
  allowAiTeams: boolean;
};

/** Half-PPR default scoring (Sleeper keys). */
export function defaultNativeScoringSettings(): Record<string, number> {
  return {
    pass_yd: 0.04,
    pass_td: 4,
    pass_int: -2,
    pass_2pt: 2,
    rush_yd: 0.1,
    rush_td: 6,
    rush_2pt: 2,
    rec: 0.5,
    rec_yd: 0.1,
    rec_td: 6,
    rec_2pt: 2,
    fum_lost: -2,
    fum_rec_td: 6,
    xpm: 1,
    xpmiss: -1,
    fgm_0_19: 3,
    fgm_20_29: 3,
    fgm_30_39: 3,
    fgm_40_49: 4,
    fgm_50p: 5,
    fgmiss: -1,
    sack: 1,
    int: 2,
    fum_rec: 2,
    ff: 1,
    safe: 2,
    blk_kick: 2,
    def_td: 6,
    def_st_td: 6,
    pts_allow_0: 10,
    pts_allow_1_6: 7,
    pts_allow_7_13: 4,
    pts_allow_14_20: 1,
    pts_allow_21_27: 0,
    pts_allow_28_34: -1,
    pts_allow_35p: -4,
  };
}

export function defaultNativeRosterSlots(): Record<RosterSlotKey, number> {
  const slots = emptyRoster();
  slots.QB = 1;
  slots.RB = 2;
  slots.WR = 2;
  slots.TE = 1;
  slots.FLEX = 1;
  slots.K = 1;
  slots.DEF = 1;
  slots.BN = 6;
  slots.IR = 1;
  return slots;
}

export type NativeLeagueSettingsInput = {
  name: string;
  seasonYear: number;
  teamCount: number;
  seasonStartWeek?: number;
  isPublic?: boolean;
  autoActivateNextYear?: boolean;
  playoffStartWeek?: number;
  playoffTeams?: number;
  playoffMatchupLength?: NativePlayoffMatchupLength;
  playoffWeekPair?: string;
  standingsTiebreaker?: NativeStandingsTiebreaker;
  allowMatchupTies?: boolean;
  matchupTiebreakerSlot?: NativeMatchupTiebreakerSlot;
  divisionsEnabled?: boolean;
  rosterSlots?: Partial<Record<RosterSlotKey, number>>;
  irAllowedStatuses?: NativeIrAllowedStatus[];
  /** @deprecated prefer irAllowedStatuses */
  irEligibility?: NativeIrEligibility;
  scoringPreset?: NativeScoringPreset;
  scoringSettings?: Record<string, number>;
  waiverType?: NativeWaiverType;
  waiverBudget?: number | null;
  waiverPeriodDays?: number;
  postDraftPlayerStatus?: NativePostDraftPlayerStatus;
  lockFaOnGametime?: boolean;
  maxAddsPerWeek?: number | null;
  maxAddsPerSeason?: number | null;
  undroppableTopPlayers?: boolean;
  rosterLockType?: NativeRosterLockType;
  leagueTz?: string;
  tradeDeadlineWeek?: number | null;
  tradeReviewHours?: number;
  tradeVetoMode?: NativeTradeVetoMode;
  maxTradesPerSeason?: number | null;
  draftMode?: NativeDraftMode;
  draftFormat?: NativeDraftFormat;
  draftOrderType?: NativeDraftOrderType;
  draftPickTimeLimitSec?: number;
  keepersPerTeam?: number;
  keeperNote?: string | null;
};

export type NativeLeagueSettingsNormalized = Required<
  Pick<
    NativeLeagueSettingsInput,
    | "name"
    | "seasonYear"
    | "teamCount"
    | "seasonStartWeek"
    | "isPublic"
    | "autoActivateNextYear"
    | "playoffStartWeek"
    | "playoffTeams"
    | "playoffMatchupLength"
    | "playoffWeekPair"
    | "standingsTiebreaker"
    | "allowMatchupTies"
    | "matchupTiebreakerSlot"
    | "divisionsEnabled"
    | "scoringPreset"
    | "waiverType"
    | "waiverPeriodDays"
    | "postDraftPlayerStatus"
    | "lockFaOnGametime"
    | "undroppableTopPlayers"
    | "rosterLockType"
    | "leagueTz"
    | "tradeReviewHours"
    | "tradeVetoMode"
    | "draftMode"
    | "draftFormat"
    | "draftOrderType"
    | "draftPickTimeLimitSec"
    | "keepersPerTeam"
  >
> & {
  rosterSlots: Record<RosterSlotKey, number>;
  irAllowedStatuses: NativeIrAllowedStatus[];
  scoringSettings: Record<string, number>;
  waiverBudget: number | null;
  maxAddsPerWeek: number | null;
  maxAddsPerSeason: number | null;
  tradeDeadlineWeek: number | null;
  maxTradesPerSeason: number | null;
  keeperNote: string | null;
};

export type NativeLeagueSettingsIssue = { path: string; message: string };

function clampInt(n: unknown, fallback: number, min: number, max: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(v)));
}

/**
 * Normalize + validate create/update settings. Does not touch the database.
 * keepersPerTeam is forced to 0 in v1 (schema-ready, behavior deferred).
 */
export function normalizeNativeLeagueSettings(
  input: NativeLeagueSettingsInput,
): { ok: true; value: NativeLeagueSettingsNormalized } | { ok: false; issues: NativeLeagueSettingsIssue[] } {
  const issues: NativeLeagueSettingsIssue[] = [];
  const name = String(input.name ?? "").trim();
  if (name.length < 1 || name.length > 128) {
    issues.push({ path: "name", message: "League name must be 1–128 characters" });
  }

  const teamCount = clampInt(input.teamCount, 10, NATIVE_LEAGUE_MIN_TEAMS, NATIVE_LEAGUE_MAX_TEAMS);
  if (
    typeof input.teamCount === "number" &&
    (input.teamCount < NATIVE_LEAGUE_MIN_TEAMS || input.teamCount > NATIVE_LEAGUE_MAX_TEAMS)
  ) {
    issues.push({
      path: "teamCount",
      message: `Team count must be ${NATIVE_LEAGUE_MIN_TEAMS}–${NATIVE_LEAGUE_MAX_TEAMS}`,
    });
  }

  const seasonYear = clampInt(input.seasonYear, new Date().getUTCFullYear(), 2020, 2100);
  const draftMode = (NATIVE_DRAFT_MODES.includes(input.draftMode as NativeDraftMode)
    ? input.draftMode
    : "offline") as NativeDraftMode;
  if (draftMode === "auto") {
    issues.push({ path: "draftMode", message: "Auto draft is not available in v1" });
  }

  const draftFormat = (NATIVE_DRAFT_FORMATS.includes(input.draftFormat as NativeDraftFormat)
    ? input.draftFormat
    : "standard") as NativeDraftFormat;
  if (draftFormat === "salary_cap") {
    issues.push({ path: "draftFormat", message: "Salary Cap draft is not available in v1" });
  }

  const keepersPerTeam = clampInt(input.keepersPerTeam ?? 0, 0, 0, 0);
  if ((input.keepersPerTeam ?? 0) > 0) {
    issues.push({ path: "keepersPerTeam", message: "Keepers are not enabled in v1 (must be 0)" });
  }

  if (issues.length) return { ok: false, issues };

  const rosterSlots = { ...defaultNativeRosterSlots(), ...(input.rosterSlots ?? {}) };
  // Clamp reserve sizes commissioners care about most.
  rosterSlots.BN = clampInt(rosterSlots.BN, 6, 0, 20);
  rosterSlots.IR = clampInt(rosterSlots.IR, 1, 0, 5);
  rosterSlots.TAXI = clampInt(rosterSlots.TAXI ?? 0, 0, 0, 5);
  const irAllowedStatuses = input.irAllowedStatuses
    ? normalizeIrAllowedStatuses(input.irAllowedStatuses)
    : input.irEligibility === "any"
      ? [...NATIVE_IR_ALLOWED_STATUS_OPTIONS]
      : [...DEFAULT_IR_ALLOWED_STATUSES];
  const scoringPreset = (NATIVE_SCORING_PRESETS.includes(input.scoringPreset as NativeScoringPreset)
    ? input.scoringPreset
    : "half") as NativeScoringPreset;
  const scoringSettings =
    scoringPreset === "custom" && input.scoringSettings
      ? { ...defaultNativeScoringSettings(), ...input.scoringSettings }
      : scoringPreset === "ppr"
        ? { ...defaultNativeScoringSettings(), rec: 1 }
        : scoringPreset === "std"
          ? { ...defaultNativeScoringSettings(), rec: 0 }
          : defaultNativeScoringSettings();

  const waiverType = (NATIVE_WAIVER_TYPES.includes(input.waiverType as NativeWaiverType)
    ? input.waiverType
    : "rolling") as NativeWaiverType;

  return {
    ok: true,
    value: {
      name,
      seasonYear,
      teamCount,
      // Allow mid-season test starts (e.g. week 5/6). Must stay before playoffs.
      seasonStartWeek: clampInt(input.seasonStartWeek ?? 1, 1, 1, 14),
      isPublic: Boolean(input.isPublic),
      autoActivateNextYear: input.autoActivateNextYear !== false,
      playoffStartWeek: clampInt(input.playoffStartWeek ?? 15, 15, 1, 18),
      playoffTeams: clampInt(input.playoffTeams ?? 4, 4, 0, 8),
      playoffMatchupLength: (NATIVE_PLAYOFF_LENGTHS.includes(
        input.playoffMatchupLength as NativePlayoffMatchupLength,
      )
        ? input.playoffMatchupLength
        : "one") as NativePlayoffMatchupLength,
      playoffWeekPair: String(input.playoffWeekPair ?? "15-17").slice(0, 16),
      standingsTiebreaker: (NATIVE_STANDINGS_TIEBREAKERS.includes(
        input.standingsTiebreaker as NativeStandingsTiebreaker,
      )
        ? input.standingsTiebreaker
        : "points_for") as NativeStandingsTiebreaker,
      allowMatchupTies: Boolean(input.allowMatchupTies),
      matchupTiebreakerSlot: (NATIVE_MATCHUP_TIEBREAKER_SLOTS.includes(
        input.matchupTiebreakerSlot as NativeMatchupTiebreakerSlot,
      )
        ? input.matchupTiebreakerSlot
        : "Bench") as NativeMatchupTiebreakerSlot,
      divisionsEnabled: Boolean(input.divisionsEnabled),
      rosterSlots,
      irAllowedStatuses,
      scoringPreset,
      scoringSettings,
      waiverType,
      waiverBudget: waiverType === "faab" ? clampInt(input.waiverBudget ?? 100, 100, 0, 10000) : null,
      waiverPeriodDays: clampInt(input.waiverPeriodDays ?? 1, 1, 0, 4),
      postDraftPlayerStatus: (NATIVE_POST_DRAFT_PLAYER_STATUS.includes(
        input.postDraftPlayerStatus as NativePostDraftPlayerStatus,
      )
        ? input.postDraftPlayerStatus
        : "free_agents") as NativePostDraftPlayerStatus,
      lockFaOnGametime: input.lockFaOnGametime !== false,
      maxAddsPerWeek: input.maxAddsPerWeek == null ? null : clampInt(input.maxAddsPerWeek, 0, 0, 100),
      maxAddsPerSeason: input.maxAddsPerSeason == null ? null : clampInt(input.maxAddsPerSeason, 0, 0, 500),
      undroppableTopPlayers: Boolean(input.undroppableTopPlayers),
      rosterLockType: (NATIVE_ROSTER_LOCK_TYPES.includes(input.rosterLockType as NativeRosterLockType)
        ? input.rosterLockType
        : "game_time") as NativeRosterLockType,
      leagueTz: String(input.leagueTz ?? "America/New_York").slice(0, 64),
      tradeDeadlineWeek:
        input.tradeDeadlineWeek == null ? null : clampInt(input.tradeDeadlineWeek, 14, 1, 18),
      tradeReviewHours: clampInt(input.tradeReviewHours ?? 24, 24, 0, 168),
      tradeVetoMode: (NATIVE_TRADE_VETO_MODES.includes(input.tradeVetoMode as NativeTradeVetoMode)
        ? input.tradeVetoMode
        : "commissioner") as NativeTradeVetoMode,
      maxTradesPerSeason:
        input.maxTradesPerSeason == null ? null : clampInt(input.maxTradesPerSeason, 0, 0, 100),
      draftMode,
      draftFormat,
      draftOrderType: (NATIVE_DRAFT_ORDER_TYPES.includes(input.draftOrderType as NativeDraftOrderType)
        ? input.draftOrderType
        : "snake") as NativeDraftOrderType,
      draftPickTimeLimitSec: clampInt(input.draftPickTimeLimitSec ?? 90, 90, 15, 600),
      keepersPerTeam,
      keeperNote: input.keeperNote?.trim() ? input.keeperNote.trim().slice(0, 2000) : null,
    },
  };
}

/** Generate an uppercase invite code (league join, not site signup). */
export function generateNativeInviteCode(length = 8): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < length; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}
