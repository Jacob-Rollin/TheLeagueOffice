/** Client-safe Matchup Replay types (no Node / server imports). */

import type { ScoringMap } from "./scoring-map";

export type MatchupReplayStarter = {
  id: string;
  name: string;
  pos: string;
  team: string;
  /** Pre-week projected fantasy points in league scoring. */
  projection: number;
};

export type MatchupReplaySideInput = {
  name: string;
  record?: string | null;
  logo?: string | null;
  /** Platform final score for this side (Sleeper / ESPN). */
  finalScore: number;
  /** Original weekly projected total. */
  projectedScore: number;
  starters: MatchupReplayStarter[];
};

export type MatchupReplayRequest = {
  season?: string | undefined;
  week: number;
  scoringMap: ScoringMap;
  left: MatchupReplaySideInput;
  right: MatchupReplaySideInput;
};

export type MatchupReplayTdEvent = {
  /** Warped chart X (0–100), FantasyPros-style Sunday-weighted timeline. */
  t: number;
  sleeperId: string;
  name: string;
  pos: string;
  team: string;
  side: "left" | "right";
  yards: number;
  kind: "rec_td" | "rush_td" | "pass_td";
  headline: string;
  /** Fantasy points this play added for the highlighted player. */
  points: number;
};

export type MatchupReplayPoint = {
  /** Warped chart X (0–100). */
  t: number;
  label: string;
  scoreLeft: number;
  scoreRight: number;
  winPctLeft: number;
  winPctRight: number;
  /** Present when this tick is a highlight TD for a rostered starter. */
  tdIndex?: number | undefined;
};

export type MatchupReplayAxisTick = {
  /** Warped chart X (0–100). */
  t: number;
  label: string;
};

export type MatchupReplayPayload = {
  season: string;
  week: number;
  leftName: string;
  rightName: string;
  leftRecord: string | null;
  rightRecord: string | null;
  leftLogo: string | null;
  rightLogo: string | null;
  leftProjected: number;
  rightProjected: number;
  /** Display series ending at platform finals. */
  points: MatchupReplayPoint[];
  tds: MatchupReplayTdEvent[];
  axisTicks: MatchupReplayAxisTick[];
  /** True when nflverse had no usable scoring plays for these starters. */
  empty: boolean;
};
