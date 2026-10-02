import { fetchJson } from "./http";
import { canonTeam } from "./names";
import type { Game } from "./types";

type EspnEvent = {
  date?: string;
  status?: { type?: { state?: string } };
  competitions?: {
    competitors?: { homeAway?: string; score?: string; team?: { abbreviation?: string } }[];
    odds?: { details?: string; overUnder?: number }[];
  }[];
};

/** US Eastern offset in hours for a date (DST from 2nd Sunday of March to 1st Sunday of November). */
function easternOffset(year: number, month: number, day: number): number {
  const nthSunday = (m: number, n: number) => {
    const first = new Date(Date.UTC(year, m, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + (n - 1) * 7;
  };
  const date = month * 100 + day;
  const start = 2 * 100 + nthSunday(2, 2);
  const end = 10 * 100 + nthSunday(10, 1);
  return date >= start && date < end ? 4 : 5;
}

function easternToIso(gameday: string, gametime: string): string | null {
  const [y, m, d] = gameday.split("-").map(Number);
  const [hh, mm] = gametime.split(":").map(Number);
  if (!y || !m || !d || hh == null || mm == null) return null;
  const offset = easternOffset(y, m - 1, d);
  return new Date(Date.UTC(y, m - 1, d, hh + offset, mm)).toISOString();
}

function impliedTotals(home: string, away: string, homeSpread: number | null, total: number | null) {
  if (homeSpread == null || total == null || !Number.isFinite(homeSpread) || !Number.isFinite(total)) return null;
  return { [home]: total / 2 + homeSpread / 2, [away]: total / 2 - homeSpread / 2 };
}

/**
 * This week's games keyed by both team abbreviations. Kickoff and live state
 * come from ESPN's scoreboard; betting lines from nflverse, falling back to
 * ESPN's odds. Without ESPN, kickoffs come from the nflverse schedule.
 */
export async function loadWeekGames(
  season: number,
  week: number,
  nflverseGames: Record<string, string>[],
  now = Date.now(),
): Promise<Map<string, Game>> {
  const games = new Map<string, Game>();
  const lines = new Map<string, { homeSpread: number | null; total: number | null }>();
  for (const g of nflverseGames) {
    if (Number(g.season) !== season || Number(g.week) !== week) continue;
    const home = canonTeam(g.home_team);
    const away = canonTeam(g.away_team);
    const homeSpread = g.spread_line ? Number(g.spread_line) : null;
    const total = g.total_line ? Number(g.total_line) : null;
    lines.set(`${away}@${home}`, { homeSpread, total });
    const kickoff = easternToIso(g.gameday ?? "", g.gametime ?? "");
    if (!kickoff) continue;
    const t = Date.parse(kickoff);
    const state: Game["state"] = now < t ? "pre" : now > t + 4.5 * 3_600_000 ? "post" : "in";
    const game: Game = {
      home,
      away,
      kickoff,
      state,
      implied: impliedTotals(home, away, homeSpread, total),
      homeSpread,
      homeScore: g.home_score ? Number(g.home_score) : null,
      awayScore: g.away_score ? Number(g.away_score) : null,
    };
    games.set(home, game);
    games.set(away, game);
  }

  const res = await fetchJson<{ events?: EspnEvent[] }>(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`,
  );
  for (const event of res.data?.events ?? []) {
    const comp = event.competitions?.[0];
    const homeC = comp?.competitors?.find((c) => c.homeAway === "home");
    const awayC = comp?.competitors?.find((c) => c.homeAway === "away");
    if (!homeC?.team?.abbreviation || !awayC?.team?.abbreviation || !event.date) continue;
    const home = canonTeam(homeC.team.abbreviation);
    const away = canonTeam(awayC.team.abbreviation);
    const espnState = event.status?.type?.state;
    const state: Game["state"] = espnState === "in" ? "in" : espnState === "post" ? "post" : "pre";
    let { homeSpread, total } = lines.get(`${away}@${home}`) ?? { homeSpread: null, total: null };
    const odds = comp?.odds?.[0];
    if (total == null && odds?.overUnder != null) total = odds.overUnder;
    if (homeSpread == null && odds?.details) {
      const m = odds.details.match(/^([A-Z]+)\s+(-?\d+(?:\.\d+)?)$/);
      if (m) homeSpread = canonTeam(m[1]) === home ? -Number(m[2]) : Number(m[2]);
    }
    const game: Game = {
      home,
      away,
      kickoff: new Date(event.date).toISOString(),
      state,
      implied: impliedTotals(home, away, homeSpread, total),
      homeSpread,
      homeScore: homeC.score != null && state !== "pre" ? Number(homeC.score) : null,
      awayScore: awayC.score != null && state !== "pre" ? Number(awayC.score) : null,
    };
    games.set(home, game);
    games.set(away, game);
  }
  return games;
}

/** True once a game has kicked off (or is past its scheduled kickoff). */
export function hasStarted(game: Game, now = Date.now()): boolean {
  return game.state !== "pre" || now >= Date.parse(game.kickoff);
}
