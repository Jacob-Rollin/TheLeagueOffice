import type { Pos } from "@/lib/draft";

export type ProjectionPosFilter = "QB" | "RB" | "WR" | "TE" | "FLEX" | "K" | "DEF";

export type ProjectionStatSortKey =
  | "pass_yd"
  | "pass_td"
  | "pass_int"
  | "rush_att"
  | "rush_yd"
  | "rush_td"
  | "rec"
  | "rec_yd"
  | "rec_td"
  | "fgm"
  | "fga"
  | "xpm"
  | "sack"
  | "int"
  | "fum_rec"
  | "def_td"
  | "pts_allow";

export type ProjectionStatCol = {
  key: ProjectionStatSortKey;
  label: string;
  digits?: number;
  resolve?: (stats: Record<string, number> | null) => number | null;
};

export type ProjectionStatGroup = { label: string; cols: ProjectionStatCol[] };

export type FlatProjectionStatCol = ProjectionStatCol & { groupStart: boolean };

export const PROJECTION_POS_FILTERS: ProjectionPosFilter[] = [
  "QB",
  "RB",
  "WR",
  "TE",
  "FLEX",
  "K",
  "DEF",
];

export const PROJECTION_FLEX_OK = new Set<Pos>(["RB", "WR", "TE"]);

const PASS_COLS: ProjectionStatCol[] = [
  { key: "pass_yd", label: "Yds" },
  { key: "pass_td", label: "Td", digits: 1 },
  { key: "pass_int", label: "Int", digits: 1 },
];

const RUSH_COLS: ProjectionStatCol[] = [
  { key: "rush_att", label: "Att", digits: 1 },
  { key: "rush_yd", label: "Yds" },
  { key: "rush_td", label: "Td", digits: 1 },
];

const REC_COLS: ProjectionStatCol[] = [
  { key: "rec", label: "Rec", digits: 1 },
  { key: "rec_yd", label: "Yds" },
  { key: "rec_td", label: "Td", digits: 1 },
];

const K_COLS: ProjectionStatCol[] = [
  { key: "fgm", label: "Fgm", digits: 1 },
  {
    key: "fga",
    label: "Fga",
    resolve: (stats) => {
      if (!stats) return null;
      if (stats["fga"] != null && Number.isFinite(Number(stats["fga"]))) {
        return Number(stats["fga"]);
      }
      const made = Number(stats["fgm"] ?? NaN);
      const miss = Number(stats["fgmiss"] ?? NaN);
      if (Number.isFinite(made) && Number.isFinite(miss)) return made + miss;
      return null;
    },
  },
  { key: "xpm", label: "Xpm", digits: 1 },
];

const DEF_COLS: ProjectionStatCol[] = [
  { key: "sack", label: "Sack", digits: 1 },
  { key: "int", label: "Int", digits: 1 },
  { key: "fum_rec", label: "Fum Rec", digits: 1 },
  {
    key: "def_td",
    label: "Td",
    digits: 1,
    resolve: (stats) => {
      if (!stats) return null;
      const defTd = Number(stats["def_td"] ?? NaN);
      if (Number.isFinite(defTd)) return defTd;
      const td = Number(stats["td"] ?? NaN);
      return Number.isFinite(td) ? td : null;
    },
  },
  { key: "pts_allow", label: "Pts Allow" },
];

export function projectionGroupsForPos(pos: ProjectionPosFilter): ProjectionStatGroup[] {
  if (pos === "QB") {
    return [
      { label: "Passing", cols: PASS_COLS },
      { label: "Rushing", cols: RUSH_COLS },
    ];
  }
  if (pos === "K") return [{ label: "Kicking", cols: K_COLS }];
  if (pos === "DEF") return [{ label: "Defense", cols: DEF_COLS }];
  if (pos === "WR" || pos === "TE") {
    return [
      { label: "Receiving", cols: REC_COLS },
      { label: "Rushing", cols: RUSH_COLS },
    ];
  }
  return [
    { label: "Rushing", cols: RUSH_COLS },
    { label: "Receiving", cols: REC_COLS },
  ];
}

export function flattenProjectionGroups(
  groups: ProjectionStatGroup[],
): FlatProjectionStatCol[] {
  return groups.flatMap((g) =>
    g.cols.map((col, i) => ({
      ...col,
      groupStart: i === 0,
    })),
  );
}

export function projectionStatNumber(
  stats: Record<string, number> | null,
  col: ProjectionStatCol,
): number | null {
  if (col.resolve) return col.resolve(stats);
  if (!stats) return null;
  const raw = stats[col.key];
  if (raw == null || !Number.isFinite(Number(raw))) return null;
  return Number(raw);
}

export function formatProjectionStat(
  stats: Record<string, number> | null,
  col: ProjectionStatCol,
): string {
  const n = projectionStatNumber(stats, col);
  if (n == null) return "—";
  return (col.digits ?? 0) > 0 ? n.toFixed(col.digits) : String(Math.round(n));
}
