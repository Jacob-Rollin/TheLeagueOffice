/**
 * Browser-side Sleeper loaders for public endpoints.
 * Prefer these over createServerFn whenever the data is not secret-gated —
 * each visitor uses their own rate-limit pool and Vercel Fluid stays idle.
 *
 * Per-visitor safeguards (avoid IP bans without bouncing cost to Vercel):
 * - IndexedDB TTL cache + in-flight dedupe (`getCached`)
 * - Soft empty returns on most failures (no Fluid fallback)
 * - 429 backoff (one retry) then stale/empty
 * - Projection week fan-out capped at 2 concurrent
 */
import { getCached } from "@/lib/sleeper-cache";
import {
  SLEEPER_BASE,
  byeWeeksFromSchedule,
  currentSeason,
  num,
  positionsQuery,
  type Pos,
} from "@/lib/players-build";
import type { CareerSeasonRow, GameLog, NextGame, PlayerBio } from "@/lib/players.server";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Keep cold game-log opens from opening 10+ projection fetches at once. */
const PROJ_WEEK_CONCURRENCY = 2;

async function sleeperFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (res.status !== 429) return res;
  // One polite backoff — do not retry storms; caller soft-fails or uses stale.
  await new Promise((r) => setTimeout(r, 1200));
  return fetch(url, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers ?? {}) },
  });
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

export type NflStateClient = { season: string; week: number };

/** Short enough that Tuesday week-roll lands in completed-week metrics quickly. */
const NFL_STATE_TTL_MS = 10 * 60 * 1000;

export async function fetchNflStateClient(): Promise<NflStateClient> {
  // v2 busts IndexedDB rows that pinned an older `week` across the roll.
  return getCached("nfl-state-client-v2", NFL_STATE_TTL_MS, async () => {
    const res = await sleeperFetch("https://api.sleeper.app/v1/state/nfl");
    if (!res.ok) throw new Error(`state ${res.status}`);
    const json = (await res.json()) as Record<string, unknown>;
    return {
      season: String(json["season"] ?? currentSeason()),
      // Sleeper `week` advances when the slate rolls; use it (not display_week)
      // so completed weeks include the slate that just finished.
      week: Math.max(1, Number(json["week"] ?? 1) || 1),
    };
  });
}

/** Live Sleeper injury overlay — reuses shared week projection bundle (no second download). */
export async function fetchLiveInjuryStatusesClient(): Promise<
  Record<string, { status: string | null; bodyPart: string | null }>
> {
  return getCached("live-injury-statuses-v2", 10 * 60 * 1000, async () => {
    const state = await fetchNflStateClient();
    const week = Math.min(Math.max(state.week, 1), 18);
    const bundle = await weekProjectionBundle(state.season, week);
    const out: Record<string, { status: string | null; bodyPart: string | null }> = {};
    for (const [id, row] of Object.entries(bundle)) {
      out[id] = { status: row.injuryStatus, bodyPart: row.injuryBodyPart };
    }
    return out;
  });
}

export async function fetchPlayerBioClient(id: string): Promise<PlayerBio | null> {
  const clean = String(id ?? "").slice(0, 32);
  if (!clean) return null;
  return getCached(`player-bio-v1:${clean}`, DAY, async () => {
    const res = await sleeperFetch(`${SLEEPER_BASE}/players/nfl/${encodeURIComponent(clean)}`);
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    const h = typeof j["height"] === "string" ? j["height"] : null;
    const inches = h && /^\d+$/.test(h) ? Number(h) : null;
    const draftYear =
      j["metadata"] && typeof j["metadata"] === "object"
        ? (j["metadata"] as Record<string, unknown>)["rookie_year"]
        : null;
    return {
      height: inches ? `${Math.floor(inches / 12)}'${inches % 12}"` : h,
      weight: j["weight"] ? `${j["weight"]} lbs` : null,
      college: typeof j["college"] === "string" ? j["college"] : null,
      status: typeof j["status"] === "string" ? j["status"] : null,
      number: typeof j["number"] === "number" ? j["number"] : null,
      birthDate: typeof j["birth_date"] === "string" ? j["birth_date"] : null,
      draft:
        typeof draftYear === "string" || typeof draftYear === "number"
          ? `Rookie year ${draftYear}`
          : null,
    } satisfies PlayerBio;
  });
}

type ScheduleGame = {
  week: number;
  home: string;
  away: string;
  date?: string | null;
  status?: string | null;
};

async function fetchScheduleClient(
  type: "pre" | "regular",
  season: string,
): Promise<ScheduleGame[]> {
  return getCached(`schedule-${type}-${season}`, 6 * HOUR, async () => {
    const res = await sleeperFetch(`${SLEEPER_BASE}/schedule/nfl/${type}/${season}`);
    if (!res.ok) return [];
    const json = (await res.json()) as ScheduleGame[];
    return Array.isArray(json) ? json : [];
  });
}

export async function fetchNextGameClient(team: string): Promise<NextGame | null> {
  const abbr = (team || "").toUpperCase();
  if (!abbr || abbr === "FA") return null;
  const season = currentSeason();
  const [pre, reg] = await Promise.all([
    fetchScheduleClient("pre", season),
    fetchScheduleClient("regular", season),
  ]);
  type Tagged = ScheduleGame & { seasonType: "pre" | "regular" };
  const mine: Tagged[] = [
    ...pre.map((g) => ({ ...g, seasonType: "pre" as const })),
    ...reg.map((g) => ({ ...g, seasonType: "regular" as const })),
  ]
    .filter((g) => g.home === abbr || g.away === abbr)
    .sort((a, b) => {
      if (a.seasonType !== b.seasonType) return a.seasonType === "pre" ? -1 : 1;
      return a.week - b.week;
    });
  if (!mine.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const upcoming =
    mine.find((g) => (g.date ? g.date >= today : false)) ??
    mine.find((g) => g.status === "pre_game" || g.status === "in_game") ??
    mine[0]!;
  const isHome = upcoming.home === abbr;
  return {
    season,
    week: upcoming.week,
    home: upcoming.home,
    away: upcoming.away,
    date: upcoming.date ?? null,
    isHome,
    opponent: isHome ? upcoming.away : upcoming.home,
    seasonType: upcoming.seasonType,
  };
}

async function weeklyRawClient(
  id: string,
  season: string,
): Promise<Record<string, { stats?: Record<string, number> | null }>> {
  return getCached(`weekly-raw-v1:${season}:${id}`, 15 * 60 * 1000, async () => {
    const res = await sleeperFetch(
      `${SLEEPER_BASE}/stats/nfl/player/${encodeURIComponent(id)}?season_type=regular&season=${season}&grouping=week`,
    );
    if (!res.ok) return {};
    const j = (await res.json()) as Record<string, { stats?: Record<string, number> | null }> | null;
    return j && typeof j === "object" ? j : {};
  });
}

const LOG_KEYS = [
  "rush_att",
  "rush_yd",
  "rush_td",
  "rec",
  "rec_tgt",
  "rec_yd",
  "rec_td",
  "pass_att",
  "pass_cmp",
  "pass_yd",
  "pass_td",
  "pass_int",
  "fum_lost",
] as const;

type WeekProjBundle = Record<
  string,
  {
    std: number | null;
    half: number | null;
    ppr: number | null;
    raw: Record<string, number>;
    injuryStatus: string | null;
    injuryBodyPart: string | null;
  }
>;

async function weekProjectionBundle(season: string, week: number): Promise<WeekProjBundle> {
  // v2: includes injury fields so ATP overlay reuses the same download.
  return getCached(`week-proj-bundle-v2:${season}|${week}`, 30 * 60 * 1000, async () => {
    const url = `${SLEEPER_BASE}/projections/nfl/${season}/${week}?season_type=regular&${positionsQuery()}`;
    const res = await sleeperFetch(url);
    if (!res.ok) return {};
    const rows = (await res.json()) as Array<{
      player_id?: string;
      stats?: Record<string, number>;
      player?: { injury_status?: string | null; injury_body_part?: string | null } | null;
    }>;
    const map: WeekProjBundle = {};
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row.player_id || !row.stats) continue;
      const raw: Record<string, number> = {};
      for (const [k, v] of Object.entries(row.stats)) {
        if (v != null && Number.isFinite(Number(v))) raw[k] = Number(v);
      }
      const std = row.stats["pts_std"];
      const half = row.stats["pts_half_ppr"];
      const ppr = row.stats["pts_ppr"];
      map[String(row.player_id)] = {
        std: std != null && Number(std) > 0 ? Number(std) : null,
        half: half != null && Number(half) > 0 ? Number(half) : null,
        ppr: ppr != null && Number(ppr) > 0 ? Number(ppr) : null,
        raw,
        injuryStatus: row.player?.injury_status?.trim() || null,
        injuryBodyPart: row.player?.injury_body_part?.trim() || null,
      };
    }
    return map;
  });
}

/**
 * Season game logs from the browser (actuals + schedule + upcoming-week projs).
 * Only pulls projection weeks that are still unplayed — never an 18-week Fluid fan-out.
 */
export async function fetchGameLogsClient(
  id: string,
  team: string,
  pos: string,
  seasonRequest?: string | null,
  opts?: { includeCareer?: boolean },
): Promise<{ season: string; logs: GameLog[]; career: CareerSeasonRow[] } | null> {
  const clean = String(id ?? "").slice(0, 32);
  if (!clean) return null;
  const includeCareer = opts?.includeCareer !== false;
  const current = currentSeason();
  const requested = (seasonRequest ?? "").trim();
  const season = requested && /^\d{4}$/.test(requested) ? requested : current;
  const upperTeam = (team || "").toUpperCase() || "FA";
  const upperPos = (pos || "").toUpperCase() as Pos;
  const state = await fetchNflStateClient().catch(() => ({ season: current, week: 1 }));

  const careerYears = includeCareer
    ? [current, String(Number(current) - 1), String(Number(current) - 2)].filter(
        (y, i, arr) => /^\d{4}$/.test(y) && arr.indexOf(y) === i,
      )
    : [season];

  const buildLogs = async (year: string, withProj: boolean): Promise<GameLog[]> => {
    const [raw, schedule] = await Promise.all([
      weeklyRawClient(clean, year),
      fetchScheduleClient("regular", year),
    ]);
    const byeByTeam = byeWeeksFromSchedule(schedule);
    const byeWeek = byeByTeam.get(upperTeam) ?? null;
    const byWeek = new Map<number, GameLog>();
    const playedWeeks = new Set<number>();

    for (const [wk, entry] of Object.entries(raw)) {
      const stats = entry?.stats;
      if (!stats) continue;
      const week = Number(wk);
      if (!Number.isFinite(week)) continue;
      playedWeeks.add(week);
      const game = schedule.find(
        (g) => g.week === week && (g.home === upperTeam || g.away === upperTeam),
      );
      const opp = game
        ? game.home === upperTeam
          ? `vs ${game.away}`
          : `@ ${game.home}`
        : null;
      const rawStats: Record<string, number> = {};
      for (const k of LOG_KEYS) {
        if (stats[k] != null && Number.isFinite(Number(stats[k]))) {
          rawStats[k] = num(stats[k], 0);
        }
      }
      byWeek.set(week, {
        week,
        opp,
        points: {
          std: num(stats["pts_std"], 0),
          half: num(stats["pts_half_ppr"], 0),
          ppr: num(stats["pts_ppr"], 0),
        },
        line: [],
        raw: rawStats,
        played: true,
        isBye: false,
        seasonYear: year,
        proj: null,
        projRaw: {},
      });
    }

    // All remaining current-season weeks (through 18). Bundles are shared in
    // IndexedDB across players; concurrency stays capped to protect visitor IPs.
    const projWeeks =
      withProj && year === state.season
        ? Array.from({ length: 18 }, (_, i) => i + 1).filter(
            (w) => !playedWeeks.has(w) && w >= state.week,
          )
        : [];
    const projHits = await mapPool(projWeeks, PROJ_WEEK_CONCURRENCY, async (w) => {
      const bundle = await weekProjectionBundle(year, w);
      return [w, bundle[clean] ?? null] as const;
    });
    const projByWeek = new Map(projHits.filter(([, b]) => b != null));

    const logs: GameLog[] = [];
    for (let week = 1; week <= 18; week++) {
      const hit = byWeek.get(week);
      const bundle = projByWeek.get(week) ?? null;
      const proj = bundle
        ? { std: bundle.std, half: bundle.half, ppr: bundle.ppr }
        : null;
      if (hit) {
        logs.push({ ...hit, proj, projRaw: bundle?.raw ?? {} });
        continue;
      }
      const isBye = byeWeek != null && week === byeWeek;
      const game = schedule.find(
        (g) => g.week === week && (g.home === upperTeam || g.away === upperTeam),
      );
      const opp = isBye
        ? "BYE"
        : game
          ? game.home === upperTeam
            ? `vs ${game.away}`
            : `@ ${game.home}`
          : null;
      logs.push({
        week,
        opp,
        points: { std: 0, half: 0, ppr: 0 },
        line: [],
        raw: {},
        played: false,
        isBye,
        seasonYear: year,
        proj,
        projRaw: bundle?.raw ?? {},
      });
    }
    return logs;
  };

  const [logs, careerLogs] = await Promise.all([
    buildLogs(season, true),
    Promise.all(careerYears.map((y) => buildLogs(y, false))),
  ]);

  const career: CareerSeasonRow[] = careerYears.map((year, i) => {
    const seasonLogs = careerLogs[i] ?? [];
    const played = seasonLogs.filter((l) => l.played);
    const pts = { std: 0, half: 0, ppr: 0 };
    let any = false;
    const raw: Record<string, number> = {};
    for (const log of played) {
      if (Number.isFinite(log.points.std)) {
        pts.std += log.points.std;
        any = true;
      }
      if (Number.isFinite(log.points.half)) pts.half += log.points.half;
      if (Number.isFinite(log.points.ppr)) pts.ppr += log.points.ppr;
      for (const [k, v] of Object.entries(log.raw)) {
        raw[k] = (raw[k] ?? 0) + v;
      }
    }
    return {
      year,
      team: upperTeam,
      games: played.length,
      pts: {
        std: any ? Math.round(pts.std * 10) / 10 : null,
        half: any ? Math.round(pts.half * 10) / 10 : null,
        ppr: any ? Math.round(pts.ppr * 10) / 10 : null,
      },
      posRank: { std: null, half: null, ppr: null },
      raw,
    };
  });

  void upperPos;
  return { season, logs, career };
}

