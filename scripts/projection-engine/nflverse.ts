import { BULK_TIMEOUT_MS } from "./config";
import { parseCsv } from "./csv";
import { cachedText } from "./http";

const RELEASES = "https://github.com/nflverse/nflverse-data/releases/download";

export interface NflverseData {
  ok: boolean;
  note?: string;
  games: Record<string, string>[];
  /** Weekly player rows for the current season, then the previous season. */
  current: Record<string, string>[];
  previous: Record<string, string>[];
}

/**
 * nflverse refreshes its weekly files nightly in season, so an hour of disk
 * cache is plenty; last season's file never changes.
 */
export async function loadNflverse(season: number): Promise<NflverseData> {
  const [games, current, previous] = await Promise.all([
    cachedText("nflverse-games.csv", `${RELEASES}/schedules/games.csv`, 1, BULK_TIMEOUT_MS),
    cachedText(
      `nflverse-stats-${season}.csv`,
      `${RELEASES}/stats_player/stats_player_week_${season}.csv`,
      1,
      BULK_TIMEOUT_MS,
    ),
    cachedText(
      `nflverse-stats-${season - 1}.csv`,
      `${RELEASES}/stats_player/stats_player_week_${season - 1}.csv`,
      24 * 30,
      BULK_TIMEOUT_MS,
    ),
  ]);
  const notes: string[] = [];
  if (!games.ok) notes.push(`schedule ${games.error}`);
  if (!current.ok) notes.push(`${season} stats ${current.error}`);
  if (!previous.ok) notes.push(`${season - 1} stats ${previous.error}`);
  const reg = (rows: Record<string, string>[]) => rows.filter((r) => r.season_type === "REG");
  return {
    // Before Week 1 there is no current-season file yet; last season carries the model.
    ok: games.ok && (current.ok || previous.ok),
    ...(notes.length ? { note: notes.join(", ") } : {}),
    games: games.data ? parseCsv(games.data).filter((g) => g.game_type === "REG") : [],
    current: current.data ? reg(parseCsv(current.data)) : [],
    previous: previous.data ? reg(parseCsv(previous.data)) : [],
  };
}
