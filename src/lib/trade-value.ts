import type { TradeValueBasis, TradeValueBasisEntry } from "./players.server";

export type ValueScoring = "std" | "half" | "ppr";

const SCORING_INDEX: Record<ValueScoring, 0 | 1 | 2> = { std: 0, half: 1, ppr: 2 };
const SEASON_WEEKS = 17;

export type InSeasonValue = {
  /** Expected fantasy points per remaining week, byes and missed games included. */
  weekly: number;
  /** Current season points per game played (null before a game is played). */
  seasonPerGame: number | null;
  seasonGames: number;
  seasonTotal: number;
  /** Rest-of-season projected total and per-game rate (null without projections). */
  rosTotal: number | null;
  rosPerGame: number | null;
  /** Share of the blend coming from this season's actual production (0–1). */
  seasonWeight: number;
};

/**
 * In-season trade value. Early in the year it leans on projections (with last
 * season as a sanity check); as games are played, actual production takes over
 * and last season fades out entirely after six games. The per-game blend is
 * then scaled by availability — the share of remaining weeks with a projection —
 * so byes, injuries and suspensions lower rest-of-season value.
 */
export function inSeasonWeeklyValue(
  entry: TradeValueBasisEntry | undefined,
  basis: Pick<TradeValueBasis, "remainingWeeks" | "rosAvailable"> | null | undefined,
  seasonProjectionTotal: number,
  scoring: ValueScoring,
): InSeasonValue {
  const i = SCORING_INDEX[scoring];
  const gp = entry?.gp ?? 0;
  const seasonTotal = entry?.pts[i] ?? 0;
  const seasonPerGame = gp > 0 ? seasonTotal / gp : null;
  const prevPerGame = entry && entry.prevGp > 0 ? entry.prevPts[i] / entry.prevGp : null;

  const useRos = Boolean(basis?.rosAvailable && entry && basis.remainingWeeks > 0);
  const rosTotal = useRos ? entry!.rosPts[i] : null;
  const rosPerGame = useRos && entry!.rosGames > 0 ? entry!.rosPts[i] / entry!.rosGames : null;
  const availability = useRos ? entry!.rosGames / basis!.remainingWeeks : 1;
  const projPerGame = rosPerGame ?? Math.max(0, seasonProjectionTotal) / SEASON_WEEKS;

  const seasonWeight = seasonPerGame != null ? Math.min(0.6, gp / (gp + 5)) : 0;
  const prevWeight = prevPerGame != null ? 0.35 * Math.max(0, 1 - gp / 6) : 0;
  const projWeight = Math.max(0, 1 - seasonWeight - prevWeight);

  const perGame =
    projPerGame * projWeight + (seasonPerGame ?? 0) * seasonWeight + (prevPerGame ?? 0) * prevWeight;

  return {
    weekly: Math.max(0, perGame * availability),
    seasonPerGame,
    seasonGames: gp,
    seasonTotal,
    rosTotal,
    rosPerGame,
    seasonWeight,
  };
}
