/**
 * NFL roster status and official injury reports from nflverse.
 * - Season roster (refreshed weekly upstream): practice squad filtering and
 *   Sleeper ↔ GSIS ↔ ESPN id bridging.
 * - Injury report (refreshed daily in season): game status and practice
 *   participation from the league's official reports.
 */

const ROSTER_URL = (season: string) =>
  `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${season}.csv`;
const INJURIES_URL = (season: string) =>
  `https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_${season}.csv`;
const TTL_MS = 6 * 60 * 60 * 1000;
const INJURY_TTL_MS = 60 * 60 * 1000;

export type PracticeSquadIndex = {
  sleeperIds: Set<string>;
  /** `name|team` keys for practice squad players nflverse has no sleeper_id for. */
  nameTeamKeys: Set<string>;
};

export type NflRosterEntry = {
  gsisId: string | null;
  espnId: string | null;
  /** nflverse roster status: ACT, RES (reserve lists), DEV (practice squad), CUT, … */
  status: string;
};

export type NflRosterIndex = {
  practiceSquad: PracticeSquadIndex;
  bySleeper: Map<string, NflRosterEntry>;
};

export type NflInjuryReportEntry = {
  week: number;
  /** Game designation: Out, Doubtful, Questionable (null when only on the practice report). */
  status: string | null;
  injury: string | null;
  /** e.g. "Did Not Participate In Practice", "Limited Participation in Practice". */
  practice: string | null;
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** nflverse uses LA for the Rams; Sleeper uses LAR. */
function canonicalTeam(team: string): string {
  const t = team.trim().toUpperCase();
  if (t === "LA") return "LAR";
  if (t === "WSH") return "WAS";
  if (t === "JAC") return "JAX";
  return t;
}

function nameTeamKey(name: string, team: string): string {
  return `${normalizeName(name)}|${canonicalTeam(team)}`;
}

async function fetchRosterIndex(season: string): Promise<NflRosterIndex | null> {
  const res = await fetch(ROSTER_URL(season)).catch(() => null);
  if (!res || !res.ok) return null;
  const lines = (await res.text()).split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0] ?? "");
  const col = (name: string) => header.indexOf(name);
  const statusIdx = col("status");
  const sleeperIdx = col("sleeper_id");
  const nameIdx = col("full_name");
  const teamIdx = col("team");
  const gsisIdx = col("gsis_id");
  const espnIdx = col("espn_id");
  if (statusIdx < 0) return null;

  const practiceSquad: PracticeSquadIndex = { sleeperIds: new Set(), nameTeamKeys: new Set() };
  const bySleeper = new Map<string, NflRosterEntry>();
  for (const line of lines.slice(1)) {
    const row = parseCsvLine(line);
    const status = (row[statusIdx] ?? "").trim().toUpperCase();
    const sleeperId = sleeperIdx >= 0 ? (row[sleeperIdx] ?? "").trim() : "";
    if (sleeperId) {
      bySleeper.set(sleeperId, {
        gsisId: gsisIdx >= 0 ? (row[gsisIdx] ?? "").trim() || null : null,
        espnId: espnIdx >= 0 ? (row[espnIdx] ?? "").trim() || null : null,
        status,
      });
    }
    if (status !== "DEV") continue;
    if (sleeperId) practiceSquad.sleeperIds.add(sleeperId);
    const name = nameIdx >= 0 ? (row[nameIdx] ?? "") : "";
    const team = teamIdx >= 0 ? (row[teamIdx] ?? "") : "";
    if (name && team) practiceSquad.nameTeamKeys.add(nameTeamKey(name, team));
  }
  return { practiceSquad, bySleeper };
}

let cache: { season: string; at: number; value: Promise<NflRosterIndex | null> } | null = null;

/** nflverse season roster index; falls back to last season before the new file exists. */
export function loadNflRosterIndex(season: string): Promise<NflRosterIndex | null> {
  const now = Date.now();
  if (cache && cache.season === season && now - cache.at < TTL_MS) return cache.value;
  const value = fetchRosterIndex(season)
    .then((hit) => hit ?? fetchRosterIndex(String(Number(season) - 1)))
    .catch(() => null);
  cache = { season, at: now, value };
  void value.then((hit) => {
    if (hit == null && cache?.value === value) cache = null;
  });
  return value;
}

/** Practice squad index for the season. */
export async function loadPracticeSquadIndex(season: string): Promise<PracticeSquadIndex | null> {
  return (await loadNflRosterIndex(season))?.practiceSquad ?? null;
}

async function fetchInjuryReport(season: string): Promise<Map<string, NflInjuryReportEntry> | null> {
  const res = await fetch(INJURIES_URL(season)).catch(() => null);
  if (!res || !res.ok) return null;
  const lines = (await res.text()).split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0] ?? "");
  const col = (name: string) => header.indexOf(name);
  const gsisIdx = col("gsis_id");
  const weekIdx = col("week");
  const typeIdx = col("season_type");
  if (gsisIdx < 0 || weekIdx < 0) return null;
  const text = (row: string[], name: string) => {
    const i = col(name);
    return i >= 0 ? (row[i] ?? "").trim() || null : null;
  };

  const byGsis = new Map<string, NflInjuryReportEntry>();
  for (const line of lines.slice(1)) {
    const row = parseCsvLine(line);
    if (typeIdx >= 0 && (row[typeIdx] ?? "").trim().toUpperCase() !== "REG") continue;
    const gsisId = (row[gsisIdx] ?? "").trim();
    const week = Number(row[weekIdx]);
    if (!gsisId || !Number.isFinite(week)) continue;
    const prev = byGsis.get(gsisId);
    if (prev && prev.week > week) continue;
    byGsis.set(gsisId, {
      week,
      status: text(row, "report_status"),
      injury: text(row, "report_primary_injury") ?? text(row, "practice_primary_injury"),
      practice: text(row, "practice_status"),
    });
  }
  return byGsis;
}

let injuryCache: {
  season: string;
  at: number;
  value: Promise<Map<string, NflInjuryReportEntry> | null>;
} | null = null;

/** Latest regular-season injury report row per GSIS id. */
export function loadNflInjuryReport(season: string): Promise<Map<string, NflInjuryReportEntry> | null> {
  const now = Date.now();
  if (injuryCache && injuryCache.season === season && now - injuryCache.at < INJURY_TTL_MS) {
    return injuryCache.value;
  }
  const value = fetchInjuryReport(season).catch(() => null);
  injuryCache = { season, at: now, value };
  void value.then((hit) => {
    if (hit == null && injuryCache?.value === value) injuryCache = null;
  });
  return value;
}

export function isPracticeSquad(
  index: PracticeSquadIndex | null,
  player: { id: string; name: string; team: string },
): boolean {
  if (!index) return false;
  if (index.sleeperIds.has(player.id)) return true;
  return index.nameTeamKeys.has(nameTeamKey(player.name, player.team));
}
