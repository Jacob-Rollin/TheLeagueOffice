/** Shared types/labels for native league settings-change notices. */

export const NATIVE_SETTINGS_CHANGE_TYPE = "settings_change";

export type NativeSettingsChangeEntry = {
  key: string;
  label: string;
  from: string;
  to: string;
};

export function isNativeSettingsChangeType(type: string | null | undefined): boolean {
  return String(type ?? "").trim().toLowerCase() === NATIVE_SETTINGS_CHANGE_TYPE;
}

export function formatSettingsDisplayValue(value: unknown): string {
  if (value == null) return "None";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "None";
  }
  if (Array.isArray(value)) {
    const parts = value.map((v) => String(v ?? "").trim()).filter(Boolean);
    return parts.length ? parts.join(", ") : "None";
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "Updated";
    }
  }
  const s = String(value).trim();
  return s.length ? s : "None";
}

const SETTING_LABELS: Record<string, string> = {
  name: "League name",
  scoring_preset: "Scoring format",
  scoring_settings: "Scoring rules",
  draft_mode: "Draft mode",
  draft_format: "Draft format",
  draft_order_type: "Draft order",
  draft_pick_time_limit_sec: "Pick timer (sec)",
  season_start_week: "Season start week",
  is_public: "Public league",
  auto_activate_next_year: "Auto-activate next year",
  playoff_teams: "Playoff teams",
  playoff_matchup_length: "Playoff length",
  playoff_week_pair: "Playoff weeks",
  standings_tiebreaker: "Standings tiebreaker",
  allow_matchup_ties: "Allow matchup ties",
  matchup_tiebreaker_slot: "Matchup tiebreaker",
  divisions_enabled: "Divisions",
  waiver_type: "Waiver type",
  waiver_budget: "Waiver budget",
  waiver_period_days: "Waiver period (days)",
  post_draft_player_status: "Post-draft player status",
  lock_fa_on_gametime: "Lock FA at gametime",
  max_adds_per_week: "Max adds / week",
  max_adds_per_season: "Max adds / season",
  undroppable_top_players: "Undroppable top players",
  roster_lock_type: "Roster lock",
  trade_deadline_week: "Trade deadline week",
  trade_review_hours: "Trade review (hours)",
  trade_veto_mode: "Trade veto",
  max_trades_per_season: "Max trades / season",
  keepers_per_team: "Keepers / team",
  keeper_note: "Keeper note",
  allow_ai_teams: "Allow AI managers",
  bench_spots: "Bench spots",
  ir_spots: "IR spots",
  ir_allowed_statuses: "IR designations",
};

export function settingsChangeLabel(key: string): string {
  return SETTING_LABELS[key] ?? key.replace(/_/g, " ");
}

export function parseSettingsChangeEntries(raw: unknown): NativeSettingsChangeEntry[] {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: NativeSettingsChangeEntry[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const key = String(rec["key"] ?? "").trim();
    if (!key) continue;
    out.push({
      key,
      label: String(rec["label"] ?? settingsChangeLabel(key)).trim() || settingsChangeLabel(key),
      from: formatSettingsDisplayValue(rec["from"]),
      to: formatSettingsDisplayValue(rec["to"]),
    });
  }
  return out;
}
