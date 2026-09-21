/** Client-safe red-zone types (no Node / server imports). */

export type RedZonePos = "QB" | "RB" | "WR" | "TE";

export type RedZonePlayerRow = {
  id: string;
  name: string;
  team: string;
  pos: RedZonePos;
  rank: number;
  games: number;
  fumLost: number;
  /** Half-PPR fantasy points from red-zone production only. */
  fpts: number;
  /** FPTS / games played in the red zone sample. */
  fptsPerGame: number;
  passCmp: number;
  passAtt: number;
  passYds: number;
  passTd: number;
  passInt: number;
  passSack: number;
  rushAtt: number;
  rushYds: number;
  rushTd: number;
  /** Share of team red-zone rush attempts (0–100). */
  rushPct: number;
  rec: number;
  recTgt: number;
  recYds: number;
  recTd: number;
  /** Share of team red-zone targets (0–100). */
  tgtPct: number;
  /** Sleeper global rostered % (`owned` from research), rounded to a whole percent. */
  rostPct: number | null;
};

export type RedZoneStatsPayload = {
  season: string;
  weeksFrom: number;
  weeksTo: number;
  yardline: number;
  rowsByPos: Record<RedZonePos, RedZonePlayerRow[]>;
};
