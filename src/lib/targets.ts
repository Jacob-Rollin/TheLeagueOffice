/** Client-safe most-targeted-players types (no Node / server imports). */

export type TargetPos = "RB" | "WR" | "TE";

export type TargetedPlayerRow = {
  id: string;
  name: string;
  team: string;
  pos: TargetPos;
  /** Targets in each week (index 0 unused; weeks 1..maxWeek). */
  byWeek: number[];
  /** Season total targets across weeks 1..maxWeek. */
  total: number;
  /** Season average targets per week (total / maxWeek). */
  avg: number;
};

export type MostTargetedPayload = {
  season: string;
  maxWeek: number;
  rows: TargetedPlayerRow[];
};
