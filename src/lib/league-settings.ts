/** Offensive roster slot keys shown in league settings. IDP slots are never included. */
export const ROSTER_SLOT_KEYS = [
  "QB",
  "RB",
  "WR",
  "TE",
  "FLEX",
  "WRRB",
  "WRTE",
  "SFLEX",
  "K",
  "DEF",
  "BN",
  "IR",
  "TAXI",
] as const;

export type RosterSlotKey = (typeof ROSTER_SLOT_KEYS)[number];

export const ROSTER_SLOT_LABEL: Record<RosterSlotKey, { short: string; long: string }> = {
  QB: { short: "QB", long: "Quarterback" },
  RB: { short: "RB", long: "Running Back" },
  WR: { short: "WR", long: "Wide Receiver" },
  TE: { short: "TE", long: "Tight End" },
  FLEX: { short: "FLEX", long: "RB / WR / TE" },
  WRRB: { short: "RB/WR", long: "RB / WR Flex" },
  WRTE: { short: "WR/TE", long: "WR / TE Flex" },
  SFLEX: { short: "SFLEX", long: "Superflex (QB / RB / WR / TE)" },
  K: { short: "K", long: "Kicker" },
  DEF: { short: "DST", long: "Team Defense" },
  BN: { short: "BN", long: "Bench" },
  IR: { short: "IR", long: "Injured Reserve" },
  TAXI: { short: "TAXI", long: "Taxi Squad" },
};

export const STARTER_SLOT_KEYS: RosterSlotKey[] = ["QB", "RB", "WR", "TE", "FLEX", "WRRB", "WRTE", "SFLEX", "K", "DEF"];
export const RESERVE_SLOT_KEYS: RosterSlotKey[] = ["BN", "IR", "TAXI"];

export type DraftOrderEntry = { pick: number; team: string; isMine: boolean };

export type LeagueSettingsDetail = {
  platform: string;
  hostLeagueId: string | null;
  leagueName: string | null;
  teamName: string | null;
  avatar: string | null;
  season: string | null;
  status: string | null;
  leagueType: string | null;
  teams: number | null;
  playoffTeams: number | null;
  playoffStartWeek: number | null;
  waiverType: string | null;
  waiverBudget: number | null;
  tradeDeadlineWeek: number | null;
  tradeDeadlineDate: number | null;
  roster: Record<RosterSlotKey, number>;
  scoring: Record<string, number>;
  draft: {
    type: string | null;
    status: string | null;
    rounds: number | null;
    position: number | null;
    date: number | null;
    budget: number | null;
    order: DraftOrderEntry[];
  };
};

export function emptyRoster(): Record<RosterSlotKey, number> {
  return Object.fromEntries(ROSTER_SLOT_KEYS.map((k) => [k, 0])) as Record<RosterSlotKey, number>;
}

/** Compact lineup summary, e.g. "QB, 2 RB, 2 WR, TE, FLEX, K, DST, 6 BN". */
export function rosterSummary(roster: Record<RosterSlotKey, number>): string {
  const parts: string[] = [];
  for (const key of [...STARTER_SLOT_KEYS, "BN" as const]) {
    const n = roster[key] ?? 0;
    if (!n) continue;
    const label = ROSTER_SLOT_LABEL[key].short;
    parts.push(n === 1 ? label : `${n} ${label}`);
  }
  return parts.join(", ");
}

export function scoringFormatLabel(scoring: Record<string, number>): string {
  const rec = Number(scoring["rec"] ?? 0);
  const base = rec >= 1 ? "Full PPR" : rec === 0.5 ? "Half PPR" : rec > 0 ? `${rec} PPR` : "Standard";
  const extras: string[] = [];
  if (Number(scoring["pass_td"] ?? 4) >= 6) extras.push("6 Pt Pass TD");
  if (Number(scoring["bonus_rec_te"] ?? 0) > 0) extras.push("TE Premium");
  return [base, ...extras].join(" · ");
}

type ScoringRow = { key: string; label: string; core?: boolean };

export const SCORING_GROUPS: { id: string; label: string; rows: ScoringRow[] }[] = [
  {
    id: "passing",
    label: "Passing",
    rows: [
      { key: "pass_yd", label: "Passing Yards", core: true },
      { key: "pass_td", label: "Passing TD", core: true },
      { key: "pass_int", label: "Interception Thrown", core: true },
      { key: "pass_2pt", label: "2-Pt Conversion", core: true },
      { key: "pass_att", label: "Pass Attempt" },
      { key: "pass_cmp", label: "Completion" },
      { key: "pass_inc", label: "Incompletion" },
      { key: "pass_sack", label: "Sacked" },
      { key: "pass_int_td", label: "Pick Six Thrown" },
      { key: "pass_fd", label: "Passing First Down" },
      { key: "pass_cmp_40p", label: "40+ Yd Completion" },
      { key: "pass_td_40p", label: "40+ Yd Pass TD" },
      { key: "pass_td_50p", label: "50+ Yd Pass TD" },
      { key: "bonus_pass_yd_300", label: "300+ Yd Game Bonus" },
      { key: "bonus_pass_yd_400", label: "400+ Yd Game Bonus" },
      { key: "bonus_pass_cmp_25", label: "25+ Completions Bonus" },
    ],
  },
  {
    id: "rushing",
    label: "Rushing",
    rows: [
      { key: "rush_yd", label: "Rushing Yards", core: true },
      { key: "rush_td", label: "Rushing TD", core: true },
      { key: "rush_2pt", label: "2-Pt Conversion", core: true },
      { key: "rush_att", label: "Rush Attempt" },
      { key: "rush_fd", label: "Rushing First Down" },
      { key: "rush_40p", label: "40+ Yd Rush" },
      { key: "rush_td_40p", label: "40+ Yd Rush TD" },
      { key: "rush_td_50p", label: "50+ Yd Rush TD" },
      { key: "bonus_rush_yd_100", label: "100+ Yd Game Bonus" },
      { key: "bonus_rush_yd_200", label: "200+ Yd Game Bonus" },
      { key: "bonus_rush_att_20", label: "20+ Carries Bonus" },
    ],
  },
  {
    id: "receiving",
    label: "Receiving",
    rows: [
      { key: "rec", label: "Reception", core: true },
      { key: "rec_yd", label: "Receiving Yards", core: true },
      { key: "rec_td", label: "Receiving TD", core: true },
      { key: "rec_2pt", label: "2-Pt Conversion", core: true },
      { key: "rec_tgt", label: "Target" },
      { key: "rec_fd", label: "Receiving First Down" },
      { key: "rec_40p", label: "40+ Yd Reception" },
      { key: "rec_td_40p", label: "40+ Yd Rec TD" },
      { key: "rec_td_50p", label: "50+ Yd Rec TD" },
      { key: "bonus_rec_rb", label: "RB Reception Bonus" },
      { key: "bonus_rec_wr", label: "WR Reception Bonus" },
      { key: "bonus_rec_te", label: "TE Reception Bonus" },
      { key: "bonus_rec_yd_100", label: "100+ Yd Game Bonus" },
      { key: "bonus_rec_yd_200", label: "200+ Yd Game Bonus" },
    ],
  },
  {
    id: "kicking",
    label: "Kicking",
    rows: [
      { key: "fgm", label: "FG Made" },
      { key: "fgm_yds", label: "FG Yards" },
      { key: "fgm_0_19", label: "FG Made 0-19" },
      { key: "fgm_20_29", label: "FG Made 20-29" },
      { key: "fgm_30_39", label: "FG Made 30-39" },
      { key: "fgm_40_49", label: "FG Made 40-49" },
      { key: "fgm_50_59", label: "FG Made 50-59" },
      { key: "fgm_50p", label: "FG Made 50+" },
      { key: "fgm_60p", label: "FG Made 60+" },
      { key: "fgmiss", label: "FG Missed" },
      { key: "fgmiss_0_19", label: "FG Missed 0-19" },
      { key: "fgmiss_20_29", label: "FG Missed 20-29" },
      { key: "fgmiss_30_39", label: "FG Missed 30-39" },
      { key: "fgmiss_40_49", label: "FG Missed 40-49" },
      { key: "fgmiss_50p", label: "FG Missed 50+" },
      { key: "xpm", label: "PAT Made" },
      { key: "xpmiss", label: "PAT Missed" },
    ],
  },
  {
    id: "defense",
    label: "Defense",
    rows: [
      { key: "sack", label: "Sack" },
      { key: "int", label: "Interception" },
      { key: "fum_rec", label: "Fumble Recovery" },
      { key: "ff", label: "Forced Fumble" },
      { key: "safe", label: "Safety" },
      { key: "blk_kick", label: "Blocked Kick" },
      { key: "def_td", label: "Defensive TD" },
      { key: "def_st_td", label: "Special Teams TD" },
      { key: "def_2pt", label: "2-Pt Return" },
      { key: "pts_allow_0", label: "0 Points Allowed" },
      { key: "pts_allow_1_6", label: "1-6 Points Allowed" },
      { key: "pts_allow_7_13", label: "7-13 Points Allowed" },
      { key: "pts_allow_14_20", label: "14-20 Points Allowed" },
      { key: "pts_allow_21_27", label: "21-27 Points Allowed" },
      { key: "pts_allow_28_34", label: "28-34 Points Allowed" },
      { key: "pts_allow_35p", label: "35+ Points Allowed" },
    ],
  },
  {
    id: "misc",
    label: "Misc",
    rows: [
      { key: "fum_lost", label: "Fumble Lost", core: true },
      { key: "fum", label: "Fumble" },
      { key: "fum_rec_td", label: "Fumble Recovery TD" },
      { key: "st_td", label: "Special Teams Player TD" },
      { key: "st_fum_rec", label: "Special Teams Fumble Recovery" },
      { key: "kr_yd", label: "Kick Return Yards" },
      { key: "pr_yd", label: "Punt Return Yards" },
    ],
  },
];

/** Rows to render for a scoring group: core rows always, extras only when the league scores them. */
export function scoringRows(groupId: string, scoring: Record<string, number>) {
  const group = SCORING_GROUPS.find((g) => g.id === groupId);
  if (!group) return [];
  return group.rows
    .filter((r) => r.core || Number(scoring[r.key] ?? 0) !== 0)
    .map((r) => ({ ...r, value: Number(scoring[r.key] ?? 0) }));
}

export function formatScoringValue(key: string, value: number): string {
  if (/_(yd|yds)$/.test(key) && value !== 0 && Math.abs(value) < 1) {
    const per = 1 / Math.abs(value);
    if (Math.abs(per - Math.round(per)) < 0.01) {
      return `${value < 0 ? "-" : ""}1 pt per ${Math.round(per)} yds`;
    }
  }
  const n = Number(value.toFixed(2));
  return `${n} ${Math.abs(n) === 1 ? "pt" : "pts"}`;
}
