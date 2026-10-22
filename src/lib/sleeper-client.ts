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
import { normalizeFumbleRaw } from "@/lib/game-log-normalize";
import { getCached, readCache } from "@/lib/sleeper-cache";
import {
  SLEEPER_BASE,
  byeWeeksFromSchedule,
  currentSeason,
  num,
  positionsQuery,
  type Pos,
} from "@/lib/players-build";
import type { CareerSeasonRow, GameLog, NextGame, PlayerBio } from "@/lib/players.server";
import { hasScorableProjectionStats } from "@/lib/scoring-map";
import { acquireSleeperPermit, waitForSleeperPermit } from "@/lib/sleeper-rate-budget";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Keep cold game-log opens from opening 10+ projection fetches at once. */
const PROJ_WEEK_CONCURRENCY = 2;

async function sleeperFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!(await waitForSleeperPermit("warm", 4_000))) {
    return new Response(null, { status: 429, statusText: "budget" });
  }
  const res = await fetch(url, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (res.status !== 429) return res;
  // One polite backoff — do not retry storms; caller soft-fails or uses stale.
  await new Promise((r) => setTimeout(r, 1200));
  if (!acquireSleeperPermit("warm")) {
    return new Response(null, { status: 429, statusText: "budget" });
  }
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

export type NflStateClient = {
  season: string;
  week: number;
  /** Sleeper UI slate — often lags `week` by one while scores finalize. */
  displayWeek: number;
  /** Sleeper season phase; fantasy weeks roll on Tuesday during `regular`. */
  seasonType: "pre" | "regular" | "post" | "off";
};

/** Short enough that Tuesday week-roll lands in completed-week metrics quickly. */
const NFL_STATE_TTL_MS = 10 * 60 * 1000;

function parseNflSeasonType(raw: unknown): NflStateClient["seasonType"] {
  const s = String(raw ?? "regular").toLowerCase();
  if (s === "pre" || s === "post" || s === "off" || s === "regular") return s;
  return "regular";
}

export async function fetchNflStateClient(): Promise<NflStateClient> {
  // v4 includes seasonType so current-week matchups follow the fantasy slate.
  return getCached("nfl-state-client-v4", NFL_STATE_TTL_MS, async () => {
    const res = await sleeperFetch("https://api.sleeper.app/v1/state/nfl");
    if (!res.ok) throw new Error(`state ${res.status}`);
    const json = (await res.json()) as Record<string, unknown>;
    const week = Math.max(1, Number(json["week"] ?? 1) || 1);
    const displayWeek = Math.max(1, Number(json["display_week"] ?? week) || week);
    return {
      season: String(json["season"] ?? currentSeason()),
      // Prefer advanced `week` for live matchups; analytics also reads displayWeek.
      week,
      displayWeek,
      seasonType: parseNflSeasonType(json["season_type"]),
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

function toNextGame(
  season: string,
  abbr: string,
  game: ScheduleGame & { seasonType: "pre" | "regular" },
): NextGame {
  const isHome = game.home === abbr;
  return {
    season,
    week: game.week,
    home: game.home,
    away: game.away,
    date: game.date ?? null,
    isHome,
    opponent: isHome ? game.away : game.home,
    seasonType: game.seasonType,
  };
}

/**
 * Current-slate matchup for an NFL team (player popup / outlook).
 * Uses Sleeper's fantasy `week` (rolls ~Tuesday) so TNF/Sunday/MNF stay on
 * the active week until the slate advances — not the next calendar kickoff.
 */
export async function fetchNextGameClient(team: string): Promise<NextGame | null> {
  const abbr = (team || "").toUpperCase();
  if (!abbr || abbr === "FA") return null;
  const state = await fetchNflStateClient().catch(() => null);
  const season = state?.season ?? currentSeason();
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

  const fantasyWeek = state?.week ?? null;
  const phase = state?.seasonType ?? "regular";
  let chosen: Tagged | undefined;
  if (fantasyWeek != null) {
    const preferType: "pre" | "regular" = phase === "pre" ? "pre" : "regular";
    // Keep showing this week's game while it is live or already final mid-slate.
    chosen = mine.find((g) => g.seasonType === preferType && g.week === fantasyWeek);
    if (!chosen && preferType === "regular") {
      chosen = mine.find((g) => g.seasonType === "pre" && g.week === fantasyWeek);
    }
    // Bye / no row for this week — next scheduled game after the fantasy week.
    if (!chosen) {
      chosen =
        mine.find((g) => g.seasonType === preferType && g.week > fantasyWeek) ??
        mine.find((g) => g.week > fantasyWeek);
    }
  }
  if (!chosen) {
    const today = new Date().toISOString().slice(0, 10);
    chosen =
      mine.find((g) => (g.date ? g.date.slice(0, 10) >= today : false)) ??
      mine.find((g) => g.status === "pre_game" || g.status === "in_game") ??
      mine[0]!;
  }
  return toNextGame(season, abbr, chosen);
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
  // Total fumbles (Sleeper `fum`) — distinct from lost (`fum_lost`). Omitting
  // `fum` made the player-popup FUM column show "-" whenever LOST was 1+.
  "fum",
  "fum_lost",
  // Snap% / weekly rank (Sleeper Game Log Fantasy columns).
  "off_snp",
  "tm_off_snp",
  "def_snp",
  "tm_def_snp",
  "pos_rank_std",
  "pos_rank_half_ppr",
  "pos_rank_ppr",
  // K / DST counting stats used by mobile Game Log groups.
  "fgm",
  "fga",
  "fgm_50p",
  "xpm",
  "xpa",
  "sack",
  "int",
  "fum_rec",
  "def_td",
  "safe",
  "pts_allow",
] as const;

/** Derive snap% from Sleeper off/def snap counts onto the raw log bag. */
function attachSnapPct(rawStats: Record<string, number>, stats: Record<string, unknown>) {
  const off = Number(stats["off_snp"]);
  const tmOff = Number(stats["tm_off_snp"]);
  if (Number.isFinite(off) && Number.isFinite(tmOff) && tmOff > 0) {
    rawStats["snap_pct"] = Math.round((off / tmOff) * 100);
    return;
  }
  const def = Number(stats["def_snp"]);
  const tmDef = Number(stats["tm_def_snp"]);
  if (Number.isFinite(def) && Number.isFinite(tmDef) && tmDef > 0) {
    rawStats["snap_pct"] = Math.round((def / tmDef) * 100);
  }
}


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

function weekProjEntryScorable(
  entry: WeekProjBundle[string] | null | undefined,
): boolean {
  if (!entry) return false;
  if (entry.std != null && entry.std > 0) return true;
  if (entry.half != null && entry.half > 0) return true;
  if (entry.ppr != null && entry.ppr > 0) return true;
  return hasScorableProjectionStats(entry.raw);
}

/**
 * Sleeper often strips past-week counting stats after a mid-game injury
 * (leaving ADP-only stubs). Keep any earlier scorable line we already cached.
 */
function mergeWeekProjBundles(
  prev: WeekProjBundle | null | undefined,
  next: WeekProjBundle,
): WeekProjBundle {
  if (!prev || Object.keys(prev).length === 0) return next;
  const out: WeekProjBundle = { ...next };
  for (const [id, oldEntry] of Object.entries(prev)) {
    if (!weekProjEntryScorable(oldEntry)) continue;
    if (weekProjEntryScorable(out[id])) continue;
    const fresh = next[id];
    out[id] = {
      ...oldEntry,
      injuryStatus: fresh?.injuryStatus ?? oldEntry.injuryStatus,
      injuryBodyPart: fresh?.injuryBodyPart ?? oldEntry.injuryBodyPart,
    };
  }
  return out;
}

function projTripleUsable(
  proj: { std: number | null; half: number | null; ppr: number | null } | null | undefined,
): boolean {
  if (!proj) return false;
  return (
    (proj.std != null && proj.std > 0) ||
    (proj.half != null && proj.half > 0) ||
    (proj.ppr != null && proj.ppr > 0)
  );
}

/**
 * Kickoff-locked Sleeper pts from the public accuracy Gist (browser → gist only).
 * Soft-empty when the season file is missing — never Fluid.
 */
async function frozenSleeperWeekProjLookup(
  season: string,
): Promise<Record<string, { std: number | null; half: number | null; ppr: number | null }>> {
  return getCached(`frozen-sleeper-week-proj-v1:${season}`, 12 * HOUR, async () => {
    try {
      const { fetchAccuracyFile, frozenSleeperPtsFromAccuracy } = await import(
        "@/lib/projection-analytics"
      );
      const acc = await fetchAccuracyFile(Number(season));
      return frozenSleeperPtsFromAccuracy(acc);
    } catch {
      return {};
    }
  });
}

/** Shared IndexedDB week projection bundle (game logs + matchup proj fill). */
export async function weekProjectionBundle(season: string, week: number): Promise<WeekProjBundle> {
  // v3: sticky-merge past-week rows so mid-game injury wipes don't erase Proj.
  // Past weeks hold longer so game-log Proj columns stay warm without re-hitting
  // Sleeper after the first visitor download.
  const safeWeek = Math.max(1, Math.min(18, Math.floor(Number(week) || 1)));
  const cacheKey = `week-proj-bundle-v3:${season}|${safeWeek}`;
  let ttlMs = 30 * 60 * 1000;
  try {
    const state = await fetchNflStateClient();
    if (season === state.season && safeWeek < state.week) ttlMs = 14 * DAY;
  } catch {
    /* keep default TTL */
  }
  return getCached(cacheKey, ttlMs, async () => {
    const url = `${SLEEPER_BASE}/projections/nfl/${season}/${safeWeek}?season_type=regular&${positionsQuery()}`;
    const res = await sleeperFetch(url);
    if (!res.ok) {
      const prior = await readCache<WeekProjBundle>(cacheKey);
      return prior?.data ?? {};
    }
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
    // Merge with expired cache so Sleeper's ADP-only post-injury stubs do not
    // overwrite kickoff projections we already stored for this week.
    const prior = await readCache<WeekProjBundle>(cacheKey);
    return mergeWeekProjBundles(prior?.data, map);
  });
}

/**
 * Season game logs from the browser (actuals + schedule + weekly projs).
 * Weeks 1–18 use shared IndexedDB projection bundles (capped concurrency) for
 * the requested season — including past seasons when expanded — for the
 * game-log Proj column. No Fluid fan-out.
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
  // Default off — only load multi-year career when a UI surface asks for it.
  const includeCareer = opts?.includeCareer === true;
  const current = currentSeason();
  const requested = (seasonRequest ?? "").trim();
  const season = requested && /^\d{4}$/.test(requested) ? requested : current;
  const upperTeam = (team || "").toUpperCase() || "FA";
  const upperPos = (pos || "").toUpperCase() as Pos;

  const careerYears = includeCareer
    ? [current, String(Number(current) - 1), String(Number(current) - 2)].filter(
        (y, i, arr) => /^\d{4}$/.test(y) && arr.indexOf(y) === i,
      )
    : [];

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
      const normalized = normalizeFumbleRaw(rawStats);
      attachSnapPct(normalized, stats as Record<string, unknown>);
      byWeek.set(week, {
        week,
        opp,
        points: {
          std: num(stats["pts_std"], 0),
          half: num(stats["pts_half_ppr"], 0),
          ppr: num(stats["pts_ppr"], 0),
        },
        line: [],
        raw: normalized,
        played: true,
        isBye: false,
        seasonYear: year,
        proj: null,
        projRaw: {},
      });
    }

    // Weeks 1–18 projection bundles (current + past seasons when requested).
    // Shared in IndexedDB across every player popup; concurrency stays capped.
    // Past weeks sticky-merge + kickoff-locked Gist fallback retain Proj after
    // Sleeper strips mid-game injury lines.
    const projWeeks = withProj ? Array.from({ length: 18 }, (_, i) => i + 1) : [];
    const [projHits, frozenLookup] = await Promise.all([
      mapPool(projWeeks, PROJ_WEEK_CONCURRENCY, async (w) => {
        const bundle = await weekProjectionBundle(year, w);
        return [w, bundle[clean] ?? null] as const;
      }),
      withProj ? frozenSleeperWeekProjLookup(year) : Promise.resolve({}),
    ]);
    const projByWeek = new Map(projHits.filter(([, b]) => b != null));

    const logs: GameLog[] = [];
    for (let week = 1; week <= 18; week++) {
      const hit = byWeek.get(week);
      const bundle = projByWeek.get(week) ?? null;
      let proj = bundle
        ? { std: bundle.std, half: bundle.half, ppr: bundle.ppr }
        : null;
      // Keep kickoff Proj when Sleeper later clears the weekly line (injury).
      if (!projTripleUsable(proj)) {
        const frozen = frozenLookup[`${week}|${clean}`];
        if (projTripleUsable(frozen)) proj = frozen;
      }
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

  const logs = await buildLogs(season, true);

  // Skip multi-year career fan-out unless explicitly requested (Game Logs / Career UI).
  const careerLogs = includeCareer
    ? await Promise.all(careerYears.map((y) => buildLogs(y, false)))
    : [];

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

