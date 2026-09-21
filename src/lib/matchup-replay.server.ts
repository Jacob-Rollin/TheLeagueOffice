/**
 * Matchup Replay — rebuild a completed head-to-head week from nflverse PBP.
 * Skill positions only (QB/RB/WR/TE); K/DEF omitted in v1.
 * Cumulative scores are scaled to the platform finals so the chart ends correctly.
 */

import { currentSeason, HOUR } from "./players-build";
import { scoreStats, type ScoringMap } from "./scoring-map";
import type {
  MatchupReplayPayload,
  MatchupReplayPoint,
  MatchupReplayRequest,
  MatchupReplaySideInput,
  MatchupReplayStarter,
  MatchupReplayTdEvent,
} from "./matchup-replay";

const PBP_URL = (season: string) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;
const ROSTER_URL = (season: string) =>
  `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${season}.csv`;

const SKILL = new Set(["QB", "RB", "WR", "TE"]);

type RosterHit = { sleeperId: string; pos: string; team: string; name: string };

type PlayContribution = {
  gsisId: string;
  name: string;
  team: string;
  stats: Record<string, number>;
};

type RawPlay = {
  gameId: string;
  gameDate: string;
  playId: number;
  gameSecondsRemaining: number;
  contributions: PlayContribution[];
  /** Highlight TD (receiver catch / rush), if any. */
  td: {
    gsisId: string;
    name: string;
    team: string;
    yards: number;
    kind: "rec_td" | "rush_td" | "pass_td";
  } | null;
};

function memo<T>(ttl: number, fn: (key: string) => Promise<T>) {
  const store = new Map<string, { at: number; value: Promise<T> }>();
  return (key: string): Promise<T> => {
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const value = fn(key).catch((err) => {
      store.delete(key);
      throw err;
    });
    store.set(key, { at: Date.now(), value });
    return value;
  };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (c === "," && !q) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function num(v: string | undefined): number {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function cell(row: string[], idx: Record<string, number>, name: string): string {
  const i = idx[name];
  if (i == null || i < 0) return "";
  return row[i] ?? "";
}

function tdHeadline(kind: "rec_td" | "rush_td" | "pass_td", yards: number): string {
  const y = Math.max(0, Math.round(yards));
  if (kind === "rush_td") return `${y} Yard TD Run!`;
  if (kind === "pass_td") return `${y} Yard TD Pass!`;
  return `${y} Yard TD Catch!`;
}

/**
 * FantasyPros-style warped X axis (0–100). Sunday windows get the most width.
 */
const CHART_LANDMARKS: { label: string; x: number; offsetDays: number; hourEt: number }[] = [
  { label: "Wed 7pm", x: 0, offsetDays: 0, hourEt: 19 },
  { label: "Thu 7pm", x: 12, offsetDays: 1, hourEt: 19 },
  { label: "Sun 12pm", x: 28, offsetDays: 4, hourEt: 12 },
  { label: "Sun 3pm", x: 48, offsetDays: 4, hourEt: 15 },
  { label: "Sun 7pm", x: 68, offsetDays: 4, hourEt: 19 },
  { label: "Mon 7pm", x: 86, offsetDays: 5, hourEt: 19 },
  { label: "Final", x: 100, offsetDays: 5, hourEt: 23 },
];

function etParts(ms: number): { weekday: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(ms));
  const weekdayName = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return { weekday: map[weekdayName] ?? 0, hour: hour === 24 ? 0 : hour, minute };
}

function addDaysYmd(ymd: string, days: number): string {
  const base = Date.parse(`${ymd}T12:00:00Z`);
  const next = new Date(base + days * 24 * 60 * 60 * 1000);
  return next.toISOString().slice(0, 10);
}

/** Wednesday (ET) on or before the earliest game date — NFL week anchor. */
function weekWednesdayYmd(gameDates: Iterable<string>): string {
  const sorted = [...gameDates].filter(Boolean).sort();
  const seed = sorted[0] ?? "1970-01-01";
  let ymd = seed;
  for (let i = 0; i < 7; i++) {
    const ms = Date.parse(`${ymd}T17:00:00-04:00`);
    if (etParts(ms).weekday === 3) return ymd;
    ymd = addDaysYmd(ymd, -1);
  }
  return seed;
}

function landmarkWallMs(wedYmd: string, offsetDays: number, hourEt: number): number {
  const ymd = addDaysYmd(wedYmd, offsetDays);
  return Date.parse(
    `${ymd}T${String(hourEt).padStart(2, "0")}:00:00-04:00`,
  );
}

type WarpedAxis = {
  ticks: { t: number; label: string }[];
  warp: (wallMs: number) => number;
};

function buildWarpedAxis(gameDates: Map<string, string>): WarpedAxis {
  const wed = weekWednesdayYmd(gameDates.values());
  const anchors = CHART_LANDMARKS.map((lm) => ({
    label: lm.label,
    x: lm.x,
    ms: landmarkWallMs(wed, lm.offsetDays, lm.hourEt),
  }));

  const warp = (wallMs: number): number => {
    if (!Number.isFinite(wallMs)) return 0;
    if (wallMs <= anchors[0]!.ms) return anchors[0]!.x;
    const last = anchors[anchors.length - 1]!;
    if (wallMs >= last.ms) return last.x;
    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i]!;
      const b = anchors[i + 1]!;
      if (wallMs <= b.ms) {
        const span = Math.max(1, b.ms - a.ms);
        const u = (wallMs - a.ms) / span;
        return a.x + (b.x - a.x) * Math.min(1, Math.max(0, u));
      }
    }
    return last.x;
  };

  return {
    ticks: anchors.map((a) => ({ t: a.x, label: a.label })),
    warp,
  };
}

/** Assign synthetic ET kickoffs for games on the same calendar day. */
function kickoffMsForGames(gameDates: Map<string, string>): Map<string, number> {
  const byDate = new Map<string, string[]>();
  for (const [gameId, date] of gameDates) {
    const bucket = byDate.get(date) ?? [];
    bucket.push(gameId);
    byDate.set(date, bucket);
  }
  const out = new Map<string, number>();
  for (const [date, ids] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    ids.sort();
    const weekday = etParts(Date.parse(`${date}T17:00:00-04:00`)).weekday;
    const hours = kickoffHoursForSlate(weekday, ids.length);
    ids.forEach((id, i) => {
      const hour = hours[i] ?? 20;
      const iso = `${date}T${String(hour).padStart(2, "0")}:00:00-04:00`;
      const ms = Date.parse(iso);
      out.set(id, Number.isFinite(ms) ? ms : Date.parse(`${date}T17:00:00Z`));
    });
  }
  return out;
}

/** Spread a Sunday slate across 1pm / 4pm / 8pm windows instead of stacking at 8pm. */
function kickoffHoursForSlate(weekday: number, count: number): number[] {
  if (count <= 0) return [];
  // Thursday / Monday night — single primetime window.
  if (weekday === 4 || weekday === 1) return Array.from({ length: count }, () => 20);
  // Saturday — afternoon + evening.
  if (weekday === 6) {
    return Array.from({ length: count }, (_, i) => (i < count / 2 ? 16 : 20));
  }
  // Sunday (and anything else): early / late afternoon / night.
  if (weekday === 0) {
    return Array.from({ length: count }, (_, i) => {
      const band = (i + 0.5) / count;
      if (band < 0.5) return 13;
      if (band < 0.78) return 16;
      return 20;
    });
  }
  return Array.from({ length: count }, () => 13);
}

/**
 * Keep warped X from wall-clock. Only nudge packed plays apart so they aren't
 * glued to one pixel — do not stretch TNF across a fake wider band.
 */
function redistributeAlongAxis(
  wallTimes: number[],
  warp: (ms: number) => number,
  _landmarkXs: number[],
): number[] {
  const n = wallTimes.length;
  if (!n) return [];
  const order = wallTimes
    .map((ms, i) => ({ ms, i, raw: warp(ms) }))
    .sort((a, b) => a.ms - b.ms || a.i - b.i);

  const out = new Array<number>(n).fill(0);
  for (const item of order) {
    out[item.i] = round2(Math.min(100, Math.max(0, item.raw)));
  }

  const clusterEps = 0.5;
  const minGap = 0.12;
  /** Unstick collisions only — keep slate width close to natural warp. */
  const maxClusterWidth = 4;

  let c = 0;
  while (c < order.length) {
    let end = c + 1;
    while (
      end < order.length &&
      out[order[end]!.i]! - out[order[end - 1]!.i]! <= clusterEps
    ) {
      end++;
    }
    const members = order.slice(c, end);
    if (members.length > 1) {
      const rawMin = Math.min(...members.map((m) => m.raw));
      const rawMax = Math.max(...members.map((m) => m.raw));
      const natural = Math.max(0, rawMax - rawMin);
      const needed = (members.length - 1) * minGap;
      const span = Math.min(maxClusterWidth, Math.max(natural, Math.min(needed, maxClusterWidth)));
      let start = rawMin;
      if (start + span > 100) start = Math.max(0, 100 - span);
      const ms0 = members[0]!.ms;
      const ms1 = members[members.length - 1]!.ms;
      const msSpan = Math.max(1, ms1 - ms0);
      for (const m of members) {
        const u = (m.ms - ms0) / msSpan;
        out[m.i] = round2(Math.min(100, start + span * u));
      }
    }
    c = end;
  }

  let prev = -1;
  for (const item of order) {
    if (out[item.i]! < prev) out[item.i] = prev;
    prev = out[item.i]!;
  }
  return out;
}

const GAME_DURATION_MS = 3.25 * 60 * 60 * 1000;

function normalizeTeam(team: string): string {
  const t = team.trim().toUpperCase();
  if (t === "WSH") return "WAS";
  if (t === "LA") return "LAR";
  if (t === "JAC") return "JAX";
  return t;
}

/** Map NFL team → kickoff ms for every game in the week. */
function teamKickoffMap(
  plays: RawPlay[],
  kickoffs: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const play of plays) {
    const kick = kickoffs.get(play.gameId);
    if (kick == null || !Number.isFinite(kick)) continue;
    for (const c of play.contributions) {
      const team = normalizeTeam(c.team);
      if (team) out.set(team, kick);
    }
  }
  return out;
}

/**
 * FantasyPros-style display total: unplayed players stay at full projection;
 * in-game players use actual + remaining proj; finished games use actual only.
 */
function playerAwareDisplayTotal(
  live: Map<string, number>,
  starters: MatchupReplayStarter[],
  teamKickoff: Map<string, number>,
  wallMs: number,
  scale: number,
): number {
  let total = 0;
  for (const s of starters) {
    const actual = Math.max(0, (live.get(s.id) ?? 0) * scale);
    const proj = Math.max(0, Number(s.projection) || 0);
    const kick = teamKickoff.get(normalizeTeam(s.team));
    if (kick == null || !Number.isFinite(kick)) {
      total += actual > 0.05 ? actual : proj;
      continue;
    }
    if (wallMs < kick) {
      total += proj;
    } else if (wallMs >= kick + GAME_DURATION_MS) {
      total += actual;
    } else {
      const progress = Math.min(1, Math.max(0, (wallMs - kick) / GAME_DURATION_MS));
      total += actual + Math.max(0, proj - actual) * (1 - progress);
    }
  }
  return total;
}

function cloneLive(m: Map<string, number>): Map<string, number> {
  return new Map(m);
}

function continuousWinPct(mine: number, opp: number): number {
  const a = Math.max(0, mine);
  const b = Math.max(0, opp);
  const total = a + b;
  if (total <= 0) return 50;
  const raw = a / total;
  // Milder than board-live amplification so replay curves ease like FantasyPros
  // instead of snapping on every small display-total change.
  const SMOOTHING = 2.65;
  return Math.min(99, Math.max(1, (0.5 + (raw - 0.5) * SMOOTHING) * 100));
}

function playWallClock(play: RawPlay, kickoffs: Map<string, number>): number {
  const kick = kickoffs.get(play.gameId) ?? Date.parse(`${play.gameDate}T17:00:00Z`);
  const gsr = Math.max(0, Math.min(3600, play.gameSecondsRemaining || 0));
  const progress = 1 - gsr / 3600;
  return kick + progress * GAME_DURATION_MS;
}

function sideMaps(side: MatchupReplaySideInput) {
  const starterIds = new Set(side.starters.map((s) => s.id));
  const meta = new Map(side.starters.map((s) => [s.id, s]));
  return { starterIds, meta };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const loadRosterMap = memo<Map<string, RosterHit>>(12 * HOUR, async (season) => {
  const res = await fetch(ROSTER_URL(season), {
    headers: { accept: "*/*", "user-agent": "TheLeagueOffice/1.0" },
  });
  if (!res.ok) throw new Error(`Roster upstream ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return new Map();
  const header = parseCsvLine(lines[0]!);
  const idx = Object.fromEntries(header.map((h, i) => [h, i])) as Record<string, number>;
  const map = new Map<string, RosterHit>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const row = parseCsvLine(line);
    const gsis = cell(row, idx, "gsis_id").trim();
    const sleeper = cell(row, idx, "sleeper_id").trim();
    const posRaw = cell(row, idx, "position").trim().toUpperCase();
    if (!gsis || !sleeper || !SKILL.has(posRaw)) continue;
    map.set(gsis, {
      sleeperId: sleeper,
      pos: posRaw,
      team: cell(row, idx, "team").trim(),
      name: cell(row, idx, "full_name").trim(),
    });
  }
  return map;
});

/** Season PBP → week-keyed skill scoring plays (memoized). */
const loadWeekPlays = memo<RawPlay[]>(6 * HOUR, async (key) => {
  const [season, weekRaw] = key.split(":");
  const seasonKey = season || currentSeason();
  const week = Math.max(1, Number(weekRaw) || 1);

  const res = await fetch(PBP_URL(seasonKey), {
    headers: { accept: "*/*", "user-agent": "TheLeagueOffice/1.0" },
  });
  if (!res.ok) throw new Error(`PBP upstream ${res.status}`);
  const { gunzipSync } = await import("node:zlib");
  const csv = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");
  const lines = csv.split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]!);
  const idx = Object.fromEntries(header.map((h, i) => [h, i])) as Record<string, number>;
  const plays: RawPlay[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const row = parseCsvLine(line);
    if (cell(row, idx, "season_type") !== "REG") continue;
    if (num(cell(row, idx, "week")) !== week) continue;
    const playType = cell(row, idx, "play_type");
    if (playType !== "pass" && playType !== "run") continue;

    const contributions: PlayContribution[] = [];
    let td: RawPlay["td"] = null;
    const team = cell(row, idx, "posteam").trim();
    const fum = num(cell(row, idx, "fumble_lost"));

    if (playType === "pass") {
      const passerId = cell(row, idx, "passer_player_id").trim();
      const passerName = cell(row, idx, "passer_player_name").trim();
      const passYds = num(cell(row, idx, "passing_yards"));
      const passTd = num(cell(row, idx, "pass_touchdown"));
      const passInt = num(cell(row, idx, "interception"));
      if (passerId) {
        const stats: Record<string, number> = {};
        if (passYds) stats["pass_yd"] = passYds;
        if (passTd) stats["pass_td"] = passTd;
        if (passInt) stats["pass_int"] = passInt;
        if (fum) stats["fum_lost"] = fum;
        if (Object.keys(stats).length) {
          contributions.push({ gsisId: passerId, name: passerName, team, stats });
        }
      }

      const recvId = cell(row, idx, "receiver_player_id").trim();
      const recvName = cell(row, idx, "receiver_player_name").trim();
      const complete = num(cell(row, idx, "complete_pass"));
      const recYds = num(cell(row, idx, "receiving_yards"));
      const isRecTd = Boolean(num(cell(row, idx, "touchdown")) && complete);
      if (recvId && complete) {
        const stats: Record<string, number> = { rec: 1 };
        if (recYds) stats["rec_yd"] = recYds;
        if (isRecTd) stats["rec_td"] = 1;
        contributions.push({ gsisId: recvId, name: recvName, team, stats });
        if (isRecTd) {
          td = {
            gsisId: recvId,
            name: recvName,
            team,
            yards: recYds || passYds,
            kind: "rec_td",
          };
        }
      } else if (passerId && passTd && !recvId) {
        td = {
          gsisId: passerId,
          name: passerName,
          team,
          yards: passYds,
          kind: "pass_td",
        };
      }
    }

    if (playType === "run") {
      const rushId = cell(row, idx, "rusher_player_id").trim();
      const rushName = cell(row, idx, "rusher_player_name").trim();
      const rushYds = num(cell(row, idx, "rushing_yards"));
      const rushTd = num(cell(row, idx, "rush_touchdown"));
      if (rushId) {
        const stats: Record<string, number> = {};
        if (rushYds) stats["rush_yd"] = rushYds;
        if (rushTd) stats["rush_td"] = rushTd;
        if (fum) stats["fum_lost"] = fum;
        if (Object.keys(stats).length) {
          contributions.push({ gsisId: rushId, name: rushName, team, stats });
        }
        if (rushTd) {
          td = {
            gsisId: rushId,
            name: rushName,
            team,
            yards: rushYds,
            kind: "rush_td",
          };
        }
      }
    }

    if (!contributions.length) continue;

    plays.push({
      gameId: cell(row, idx, "game_id"),
      gameDate: cell(row, idx, "game_date").trim() || "1970-01-01",
      playId: num(cell(row, idx, "play_id")),
      gameSecondsRemaining: num(cell(row, idx, "game_seconds_remaining")),
      contributions,
      td,
    });
  }

  plays.sort((a, b) => {
    if (a.gameDate !== b.gameDate) return a.gameDate.localeCompare(b.gameDate);
    if (a.gameId !== b.gameId) return a.gameId.localeCompare(b.gameId);
    if (a.gameSecondsRemaining !== b.gameSecondsRemaining) {
      return b.gameSecondsRemaining - a.gameSecondsRemaining;
    }
    return a.playId - b.playId;
  });

  return plays;
});

/**
 * Build a FantasyPros-style matchup replay timeline for one completed week.
 */
export async function loadMatchupReplay(
  input: MatchupReplayRequest,
): Promise<MatchupReplayPayload> {
  const season = (input.season || currentSeason()).slice(0, 16);
  const week = Math.max(1, Math.min(22, Math.floor(Number(input.week) || 1)));
  const scoringMap: ScoringMap = input.scoringMap ?? {};

  const left = sideMaps(input.left);
  const right = sideMaps(input.right);
  const wantedSleeper = new Set([...left.starterIds, ...right.starterIds]);

  const [roster, plays] = await Promise.all([
    loadRosterMap(season),
    loadWeekPlays(`${season}:${week}`),
  ]);

  const gsisToSleeper = new Map<string, RosterHit>();
  for (const [gsis, hit] of roster) {
    if (wantedSleeper.has(hit.sleeperId)) gsisToSleeper.set(gsis, hit);
  }

  const gameDates = new Map<string, string>();
  for (const play of plays) {
    if (!gameDates.has(play.gameId)) gameDates.set(play.gameId, play.gameDate);
  }
  const kickoffs = kickoffMsForGames(gameDates);
  const axis = buildWarpedAxis(gameDates);
  const teamKickoff = teamKickoffMap(plays, kickoffs);

  const liveLeft = new Map<string, number>();
  const liveRight = new Map<string, number>();
  for (const id of left.starterIds) liveLeft.set(id, 0);
  for (const id of right.starterIds) liveRight.set(id, 0);

  const tds: MatchupReplayTdEvent[] = [];
  /** `wallMs` is true wall clock; warped onto chart x later. */
  const rawPoints: {
    wallMs: number;
    pbpLeft: number;
    pbpRight: number;
    liveLeft: Map<string, number>;
    liveRight: Map<string, number>;
    tdIndex?: number;
  }[] = [];

  const sumMap = (m: Map<string, number>) => {
    let s = 0;
    for (const v of m.values()) s += v;
    return s;
  };

  const pushPoint = (
    wallMs: number,
    tdIndex?: number,
  ) => {
    rawPoints.push({
      wallMs,
      pbpLeft: sumMap(liveLeft),
      pbpRight: sumMap(liveRight),
      liveLeft: cloneLive(liveLeft),
      liveRight: cloneLive(liveRight),
      ...(tdIndex != null ? { tdIndex } : {}),
    });
  };

  // Opening snapshot pinned to the Wed landmark so it doesn't cluster into TNF.
  const wedYmd = weekWednesdayYmd(gameDates.values());
  pushPoint(landmarkWallMs(wedYmd, 0, 19) - 60 * 1000);

  for (const play of plays) {
    let touched = false;
    for (const c of play.contributions) {
      const hit = gsisToSleeper.get(c.gsisId);
      if (!hit) continue;
      const pts = scoreStats(c.stats, scoringMap);
      if (pts == null || !Number.isFinite(pts) || Math.abs(pts) < 0.0005) continue;
      if (left.starterIds.has(hit.sleeperId)) {
        liveLeft.set(hit.sleeperId, (liveLeft.get(hit.sleeperId) ?? 0) + pts);
        touched = true;
      } else if (right.starterIds.has(hit.sleeperId)) {
        liveRight.set(hit.sleeperId, (liveRight.get(hit.sleeperId) ?? 0) + pts);
        touched = true;
      }
    }

    let tdIndex: number | undefined;
    const wallMs = playWallClock(play, kickoffs);
    if (play.td) {
      const hit = gsisToSleeper.get(play.td.gsisId);
      if (hit) {
        const side: "left" | "right" | null = left.starterIds.has(hit.sleeperId)
          ? "left"
          : right.starterIds.has(hit.sleeperId)
            ? "right"
            : null;
        if (side) {
          const meta = (side === "left" ? left.meta : right.meta).get(hit.sleeperId);
          const highlightStats =
            play.contributions.find((c) => c.gsisId === play.td!.gsisId)?.stats ?? {};
          const points = scoreStats(highlightStats, scoringMap) ?? 0;
          tdIndex = tds.length;
          tds.push({
            t: axis.warp(wallMs),
            sleeperId: hit.sleeperId,
            name: meta?.name || hit.name || play.td.name,
            pos: meta?.pos || hit.pos,
            team: meta?.team || hit.team || play.td.team,
            side,
            yards: play.td.yards,
            kind: play.td.kind,
            headline: tdHeadline(play.td.kind, play.td.yards),
            points: round2(points),
          });
          touched = true;
        }
      }
    }

    if (!touched) continue;
    pushPoint(wallMs, tdIndex);
  }

  const pbpFinalLeft = rawPoints[rawPoints.length - 1]?.pbpLeft ?? 0;
  const pbpFinalRight = rawPoints[rawPoints.length - 1]?.pbpRight ?? 0;
  const actualLeft = Math.max(0, Number(input.left.finalScore) || 0);
  const actualRight = Math.max(0, Number(input.right.finalScore) || 0);
  const scaleLeft = pbpFinalLeft > 0.5 ? actualLeft / pbpFinalLeft : 1;
  const scaleRight = pbpFinalRight > 0.5 ? actualRight / pbpFinalRight : 1;

  // Insert kickoff / in-game / final checkpoints so remaining-proj decay
  // tracks through TNF and Sunday slates even between scoring plays.
  const starterTeams = new Set<string>();
  for (const s of [...input.left.starters, ...input.right.starters]) {
    const t = normalizeTeam(s.team);
    if (t) starterTeams.add(t);
  }
  const checkpoints: number[] = [];
  for (const team of starterTeams) {
    const kick = teamKickoff.get(team);
    if (kick == null) continue;
    checkpoints.push(kick);
    for (let p = 0.2; p < 1; p += 0.2) checkpoints.push(kick + GAME_DURATION_MS * p);
    checkpoints.push(kick + GAME_DURATION_MS);
  }
  checkpoints.sort((a, b) => a - b);

  const withChecks = [...rawPoints];
  for (const stamp of checkpoints) {
    // Find latest scoring state at or before this stamp.
    let prev = rawPoints[0]!;
    for (const row of rawPoints) {
      if (row.wallMs <= stamp) prev = row;
      else break;
    }
    if (Math.abs(prev.wallMs - stamp) < 45_000) continue;
    if (withChecks.some((r) => Math.abs(r.wallMs - stamp) < 45_000)) continue;
    withChecks.push({
      wallMs: stamp,
      pbpLeft: prev.pbpLeft,
      pbpRight: prev.pbpRight,
      liveLeft: cloneLive(prev.liveLeft),
      liveRight: cloneLive(prev.liveRight),
    });
  }
  withChecks.sort((a, b) => a.wallMs - b.wallMs || (a.tdIndex ?? -1) - (b.tdIndex ?? -1));

  // Closing snapshot at Final landmark.
  withChecks.push({
    wallMs: landmarkWallMs(wedYmd, 5, 23),
    pbpLeft: pbpFinalLeft,
    pbpRight: pbpFinalRight,
    liveLeft: cloneLive(liveLeft),
    liveRight: cloneLive(liveRight),
  });

  const leftProjTotal = Math.max(0, Number(input.left.projectedScore) || 0);
  const rightProjTotal = Math.max(0, Number(input.right.projectedScore) || 0);

  const landmarkXs = axis.ticks.map((t) => t.t);
  const spreadXs = redistributeAlongAxis(
    withChecks.map((r) => r.wallMs),
    axis.warp,
    landmarkXs,
  );
  // Force open → Final endpoints.
  if (spreadXs.length) {
    spreadXs[0] = 0;
    spreadXs[spreadXs.length - 1] = 100;
  }

  const points: MatchupReplayPoint[] = withChecks.map((row, i) => {
    const isLast = i === withChecks.length - 1;
    const chartX = isLast ? 100 : (spreadXs[i] ?? round2(axis.warp(row.wallMs)));
    const scoreLeft = isLast ? actualLeft : round2(row.pbpLeft * scaleLeft);
    const scoreRight = isLast ? actualRight : round2(row.pbpRight * scaleRight);

    let winPctLeft: number;
    let winPctRight: number;
    if (isLast) {
      if (actualLeft > actualRight + 0.005) {
        winPctLeft = 99;
        winPctRight = 1;
      } else if (actualRight > actualLeft + 0.005) {
        winPctLeft = 1;
        winPctRight = 99;
      } else {
        winPctLeft = 50;
        winPctRight = 50;
      }
    } else {
      const dispLeft = playerAwareDisplayTotal(
        row.liveLeft,
        input.left.starters,
        teamKickoff,
        row.wallMs,
        scaleLeft,
      );
      const dispRight = playerAwareDisplayTotal(
        row.liveRight,
        input.right.starters,
        teamKickoff,
        row.wallMs,
        scaleRight,
      );
      winPctLeft = continuousWinPct(dispLeft, dispRight);
      winPctRight = Math.max(1, Math.min(99, 100 - winPctLeft));
    }

    const tickLabel =
      axis.ticks.find((tick) => Math.abs(tick.t - chartX) < 1.2)?.label ??
      (isLast ? "Final" : "");

    return {
      t: chartX,
      label: tickLabel || (isLast ? "Final" : ""),
      scoreLeft,
      scoreRight,
      winPctLeft,
      winPctRight,
      ...(row.tdIndex != null ? { tdIndex: row.tdIndex } : {}),
    };
  });

  // Enforce non-decreasing chart x, and keep live events off the left edge
  // so TD callouts aren't clipped at Wed 7pm.
  for (let i = 1; i < points.length; i++) {
    const minT = i === points.length - 1 ? points[i]!.t : Math.max(points[i]!.t, 2);
    points[i]!.t = Math.max(points[i - 1]!.t, minT);
  }
  if (points.length) {
    points[0]!.t = 0;
    points[points.length - 1]!.t = 100;
  }

  // Pin each TD marker to its scoring point's chart x (already spread).
  for (let i = 0; i < tds.length; i++) {
    const point = points.find((p) => p.tdIndex === i);
    if (point) tds[i]!.t = point.t;
  }

  // Densify steep win% moves so monotone curves can ease instead of jump.
  const smoothed: MatchupReplayPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const cur = points[i]!;
    if (i > 0) {
      const prev = smoothed[smoothed.length - 1]!;
      const dWin = Math.abs(cur.winPctLeft - prev.winPctLeft);
      const dT = Math.max(0, cur.t - prev.t);
      if (dWin > 2.5 && dT > 0.04) {
        const steps = Math.min(10, Math.max(2, Math.ceil(dWin / 2)));
        for (let s = 1; s < steps; s++) {
          const u = s / steps;
          // Smoothstep win%/scores; keep t linear so the axis stays honest.
          const e = u * u * (3 - 2 * u);
          smoothed.push({
            t: round2(prev.t + dT * u),
            label: "",
            scoreLeft: round2(prev.scoreLeft + (cur.scoreLeft - prev.scoreLeft) * e),
            scoreRight: round2(prev.scoreRight + (cur.scoreRight - prev.scoreRight) * e),
            winPctLeft: prev.winPctLeft + (cur.winPctLeft - prev.winPctLeft) * e,
            winPctRight: prev.winPctRight + (cur.winPctRight - prev.winPctRight) * e,
          });
        }
      }
    }
    smoothed.push(cur);
  }
  points.length = 0;
  points.push(...smoothed);

  return {
    season,
    week,
    leftName: input.left.name,
    rightName: input.right.name,
    leftRecord: input.left.record ?? null,
    rightRecord: input.right.record ?? null,
    leftLogo: input.left.logo ?? null,
    rightLogo: input.right.logo ?? null,
    leftProjected: round2(leftProjTotal),
    rightProjected: round2(rightProjTotal),
    points,
    tds,
    axisTicks: axis.ticks,
    empty: tds.length === 0 && pbpFinalLeft < 0.5 && pbpFinalRight < 0.5,
  };
}
