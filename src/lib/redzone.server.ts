/**
 * Red-zone (inside the 20) player stats aggregated from nflverse play-by-play.
 * Only snaps with yardline_100 <= 20 are counted — nowhere else on the field.
 */

import { currentSeason, HOUR } from "./players-build";
import type { RedZonePlayerRow, RedZonePos, RedZoneStatsPayload } from "./redzone";

export type { RedZonePlayerRow, RedZonePos, RedZoneStatsPayload } from "./redzone";

const PBP_URL = (season: string) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;
const ROSTER_URL = (season: string) =>
  `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${season}.csv`;

const SKILL: RedZonePos[] = ["QB", "RB", "WR", "TE"];
export const RED_ZONE_YARDLINES = [5, 10, 15, 20] as const;
export type RedZoneYardline = (typeof RED_ZONE_YARDLINES)[number];

function normalizeYardline(raw: unknown): RedZoneYardline {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (n === 5 || n === 10 || n === 15 || n === 20) return n;
  return 20;
}

type Agg = {
  gsisId: string;
  name: string;
  team: string;
  pos: RedZonePos | null;
  games: Set<string>;
  fumLost: number;
  passCmp: number;
  passAtt: number;
  passYds: number;
  passTd: number;
  passInt: number;
  passSack: number;
  rushAtt: number;
  rushYds: number;
  rushTd: number;
  rec: number;
  recTgt: number;
  recYds: number;
  recTd: number;
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

/** Safe CSV column lookup under `noPropertyAccessFromIndexSignature`. */
function cell(row: string[], idx: Record<string, number>, name: string): string {
  const i = idx[name];
  if (i == null || i < 0) return "";
  return row[i] ?? "";
}

function emptyAgg(gsisId: string, name: string, team: string): Agg {
  return {
    gsisId,
    name,
    team,
    pos: null,
    games: new Set(),
    fumLost: 0,
    passCmp: 0,
    passAtt: 0,
    passYds: 0,
    passTd: 0,
    passInt: 0,
    passSack: 0,
    rushAtt: 0,
    rushYds: 0,
    rushTd: 0,
    rec: 0,
    recTgt: 0,
    recYds: 0,
    recTd: 0,
  };
}

function ensure(map: Map<string, Agg>, id: string, name: string, team: string): Agg {
  let row = map.get(id);
  if (!row) {
    row = emptyAgg(id, name, team);
    map.set(id, row);
  } else {
    if (name) row.name = name;
    if (team) row.team = team;
  }
  return row;
}

const loadRosterMap = memo<Map<string, { sleeperId: string; pos: RedZonePos; team: string; name: string }>>(
  12 * HOUR,
  async (season) => {
    const res = await fetch(ROSTER_URL(season), {
      headers: { accept: "*/*", "user-agent": "TheLeagueOffice/1.0" },
    });
    if (!res.ok) throw new Error(`Roster upstream ${res.status}`);
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) return new Map();
    const header = parseCsvLine(lines[0]!);
    const idx = Object.fromEntries(header.map((h, i) => [h, i])) as Record<string, number>;
    const map = new Map<string, { sleeperId: string; pos: RedZonePos; team: string; name: string }>();
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const row = parseCsvLine(line);
      const gsis = cell(row, idx, "gsis_id").trim();
      const sleeper = cell(row, idx, "sleeper_id").trim();
      const posRaw = cell(row, idx, "position").trim().toUpperCase();
      if (!gsis || !sleeper) continue;
      if (!(SKILL as string[]).includes(posRaw)) continue;
      const team = cell(row, idx, "team").trim();
      const name = cell(row, idx, "full_name").trim();
      // Prefer the most recent roster row (file is week-stacked).
      map.set(gsis, { sleeperId: sleeper, pos: posRaw as RedZonePos, team, name });
    }
    return map;
  },
);

const loadRedZoneAgg = memo<{
  season: string;
  yardline: RedZoneYardline;
  maxWeek: number;
  byGsis: Map<string, Agg>;
  teamRushAtt: Map<string, number>;
  teamTgt: Map<string, number>;
}>(6 * HOUR, async (key) => {
  const [season, ylRaw] = key.split(":");
  const seasonKey = season || currentSeason();
  const yardlineMax = normalizeYardline(Number(ylRaw));
  const res = await fetch(PBP_URL(seasonKey), {
    headers: { accept: "*/*", "user-agent": "TheLeagueOffice/1.0" },
  });
  if (!res.ok) throw new Error(`PBP upstream ${res.status}`);
  const { gunzipSync } = await import("node:zlib");
  const csv = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");
  const lines = csv.split(/\r?\n/);
  if (lines.length < 2) {
    return {
      season: seasonKey,
      yardline: yardlineMax,
      maxWeek: 0,
      byGsis: new Map(),
      teamRushAtt: new Map(),
      teamTgt: new Map(),
    };
  }
  const header = parseCsvLine(lines[0]!);
  const idx = Object.fromEntries(header.map((h, i) => [h, i])) as Record<string, number>;

  const byGsis = new Map<string, Agg>();
  const teamRushAtt = new Map<string, number>();
  const teamTgt = new Map<string, number>();
  let maxWeek = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const row = parseCsvLine(line);
    if (cell(row, idx, "season_type") !== "REG") continue;
    const yardline = num(cell(row, idx, "yardline_100"));
    if (!(yardline > 0 && yardline <= yardlineMax)) continue;
    const playType = cell(row, idx, "play_type");
    if (playType !== "pass" && playType !== "run") continue;

    const week = num(cell(row, idx, "week"));
    if (week > maxWeek) maxWeek = week;
    const team = cell(row, idx, "posteam").trim();
    const gameId = cell(row, idx, "game_id");
    const fum = num(cell(row, idx, "fumble_lost"));

    if (playType === "pass") {
      const passerId = cell(row, idx, "passer_player_id").trim();
      const passerName = cell(row, idx, "passer_player_name").trim();
      if (passerId) {
        const a = ensure(byGsis, passerId, passerName, team);
        a.passAtt += num(cell(row, idx, "pass_attempt"));
        a.passCmp += num(cell(row, idx, "complete_pass"));
        a.passYds += num(cell(row, idx, "passing_yards"));
        a.passTd += num(cell(row, idx, "pass_touchdown"));
        a.passInt += num(cell(row, idx, "interception"));
        a.passSack += num(cell(row, idx, "sack"));
        if (fum) a.fumLost += fum;
        if (gameId) a.games.add(gameId);
      }

      const recvId = cell(row, idx, "receiver_player_id").trim();
      const recvName = cell(row, idx, "receiver_player_name").trim();
      if (recvId) {
        const r = ensure(byGsis, recvId, recvName, team);
        r.recTgt += 1;
        r.rec += num(cell(row, idx, "complete_pass"));
        r.recYds += num(cell(row, idx, "receiving_yards"));
        // Receiving TDs: completed pass into the end zone credited to the receiver.
        if (num(cell(row, idx, "touchdown")) && num(cell(row, idx, "complete_pass"))) r.recTd += 1;
        if (gameId) r.games.add(gameId);
        teamTgt.set(team, (teamTgt.get(team) ?? 0) + 1);
      }
    }

    if (playType === "run") {
      const rushId = cell(row, idx, "rusher_player_id").trim();
      const rushName = cell(row, idx, "rusher_player_name").trim();
      if (rushId) {
        const a = ensure(byGsis, rushId, rushName, team);
        a.rushAtt += num(cell(row, idx, "rush_attempt")) || 1;
        a.rushYds += num(cell(row, idx, "rushing_yards"));
        a.rushTd += num(cell(row, idx, "rush_touchdown"));
        if (fum) a.fumLost += fum;
        if (gameId) a.games.add(gameId);
        teamRushAtt.set(team, (teamRushAtt.get(team) ?? 0) + (num(cell(row, idx, "rush_attempt")) || 1));
      }
    }
  }

  return { season: seasonKey, yardline: yardlineMax, maxWeek, byGsis, teamRushAtt, teamTgt };
});

function fantasyPoints(input: {
  passYds: number;
  passTd: number;
  passInt: number;
  rushYds: number;
  rushTd: number;
  rec: number;
  recYds: number;
  recTd: number;
  fumLost: number;
}): number {
  const pass = input.passYds / 25 + input.passTd * 4 + input.passInt * -2;
  const rush = input.rushYds / 10 + input.rushTd * 6;
  const rec = input.rec * 0.5 + input.recYds / 10 + input.recTd * 6;
  return pass + rush + rec - input.fumLost * 2;
}

function toRow(
  agg: Agg,
  sleeperId: string,
  pos: RedZonePos,
  teamRush: number,
  teamTargets: number,
  rostPct: number | null,
): RedZonePlayerRow {
  const games = agg.games.size;
  const fptsRaw = fantasyPoints({
    passYds: agg.passYds,
    passTd: agg.passTd,
    passInt: agg.passInt,
    rushYds: agg.rushYds,
    rushTd: agg.rushTd,
    rec: agg.rec,
    recYds: agg.recYds,
    recTd: agg.recTd,
    fumLost: agg.fumLost,
  });
  const fpts = Math.round(fptsRaw * 100) / 100;
  return {
    id: sleeperId,
    name: agg.name,
    team: agg.team,
    pos,
    rank: 0,
    games,
    fumLost: agg.fumLost,
    fpts,
    fptsPerGame: games > 0 ? Math.round((fptsRaw / games) * 100) / 100 : 0,
    passCmp: agg.passCmp,
    passAtt: agg.passAtt,
    passYds: Math.round(agg.passYds),
    passTd: agg.passTd,
    passInt: agg.passInt,
    passSack: agg.passSack,
    rushAtt: agg.rushAtt,
    rushYds: Math.round(agg.rushYds),
    rushTd: agg.rushTd,
    rushPct: teamRush > 0 ? Math.round((agg.rushAtt / teamRush) * 1000) / 10 : 0,
    rec: agg.rec,
    recTgt: agg.recTgt,
    recYds: Math.round(agg.recYds),
    recTd: agg.recTd,
    tgtPct: teamTargets > 0 ? Math.round((agg.recTgt / teamTargets) * 1000) / 10 : 0,
    rostPct,
  };
}

function hasAnyProduction(r: RedZonePlayerRow): boolean {
  return (
    r.passAtt > 0 ||
    r.rushAtt > 0 ||
    r.recTgt > 0 ||
    r.passTd > 0 ||
    r.rushTd > 0 ||
    r.recTd > 0
  );
}

export async function loadRedZoneStats(
  season = currentSeason(),
  yardlineInput: unknown = 20,
): Promise<RedZoneStatsPayload> {
  const yardline = normalizeYardline(yardlineInput);
  const seasonKey = String(season ?? currentSeason()).slice(0, 16);
  const prev = String(Number(seasonKey) - 1);
  let active = await loadRedZoneAgg(`${seasonKey}:${yardline}`).catch(() => null);
  let usedSeason = seasonKey;
  if (!active || active.byGsis.size === 0 || active.maxWeek === 0) {
    active = await loadRedZoneAgg(`${prev}:${yardline}`);
    usedSeason = prev;
  }

  const [roster, ownership] = await Promise.all([
    loadRosterMap(usedSeason).catch(() => new Map()),
    import("./players.server")
      .then((m) => m.loadSleeperOwnershipMap())
      .catch(() => new Map<string, { owned: number; started: number }>()),
  ]);
  const ownershipReady = ownership.size > 0;
  const rowsByPos: Record<RedZonePos, RedZonePlayerRow[]> = {
    QB: [],
    RB: [],
    WR: [],
    TE: [],
  };

  for (const agg of active.byGsis.values()) {
    const meta = roster.get(agg.gsisId);
    if (!meta) continue;
    const pos: RedZonePos = meta.pos;
    const sleeperId = meta.sleeperId;
    const team = meta.team || agg.team;
    agg.team = team;
    if (meta.name) agg.name = meta.name;
    const rostPct = ownershipReady ? (ownership.get(sleeperId)?.owned ?? 0) : null;
    const row = toRow(
      agg,
      sleeperId,
      pos,
      active.teamRushAtt.get(team) ?? 0,
      active.teamTgt.get(team) ?? 0,
      rostPct,
    );
    if (!hasAnyProduction(row)) continue;
    rowsByPos[pos].push(row);
  }

  for (const pos of SKILL) {
    rowsByPos[pos].sort((a, b) => b.fpts - a.fpts || b.fptsPerGame - a.fptsPerGame);
    rowsByPos[pos].forEach((r, i) => {
      r.rank = i + 1;
    });
  }

  return {
    season: usedSeason,
    weeksFrom: active.maxWeek > 0 ? 1 : 0,
    weeksTo: active.maxWeek,
    // Always report the depth that was actually aggregated.
    yardline: active.yardline,
    rowsByPos,
  };
}
