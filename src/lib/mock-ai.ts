import {
  FLEX_POSITIONS,
  POSITIONS,
  teamForPick,
  value,
  type Player,
  type Pos,
  type Settings,
} from "@/lib/draft";

export type Personality = "hero-rb" | "zero-rb" | "value" | "streamer";

export const PERSONALITIES: Personality[] = ["hero-rb", "zero-rb", "value", "streamer"];

export const PERSONALITY_LABEL: Record<Personality, string> = {
  "hero-rb": "Hero RB",
  "zero-rb": "Zero RB",
  value: "Value Purist",
  streamer: "Late QB/TE Streamer",
};

const CITIES = [
  "Brooklyn",
  "Tulsa",
  "Bozeman",
  "Sarasota",
  "Peoria",
  "Kenosha",
  "Modesto",
  "Ashland",
  "Provo",
  "Duluth",
  "Yuma",
  "Roanoke",
  "Fargo",
  "Macon",
  "Salem",
  "Bend",
  "Camden",
  "Erie",
];

const MASCOTS = [
  "Bootleggers",
  "Hooligans",
  "Gravediggers",
  "Sasquatch",
  "Ironworks",
  "Nightshade",
  "Blizzard",
  "Roughnecks",
  "Wolfpack",
  "Mudcats",
  "Lumberjacks",
  "Rustlers",
  "Voodoo",
  "Stampede",
  "Anvils",
  "Bandits",
  "Prospectors",
  "Riptide",
];

function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Randomized opponent names + strategic profiles for every computer slot. */
export function generateOpponents(
  teams: number,
  myTeam: number,
  myName: string,
): { names: Record<string, string>; personas: Record<string, Personality> } {
  const cities = shuffle(CITIES);
  const mascots = shuffle(MASCOTS);
  const names: Record<string, string> = {};
  const personas: Record<string, Personality> = {};
  let n = 0;
  for (let t = 1; t <= teams; t++) {
    if (t === myTeam) {
      names[String(t)] = myName.trim() || "My Team";
      continue;
    }
    names[String(t)] = `${cities[n % cities.length]} ${mascots[n % mascots.length]}`;
    personas[String(t)] = PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)]!;
    n++;
  }
  return { names, personas };
}

/** Hard ceilings so no AI roster over-stacks a single position group. */
const HARD_CAP: Record<Pos, number> = { QB: 2, RB: 6, WR: 7, TE: 2, K: 1, DEF: 1 };

function starterCap(pos: Pos, settings: Settings): number {
  return (
    (settings.roster[pos] ?? 0) + (FLEX_POSITIONS.includes(pos) ? (settings.roster.FLEX ?? 0) : 0)
  );
}

function personalityWeight(
  persona: Personality,
  pos: Pos,
  round: number,
  filledStarters: boolean,
): number {
  // Anti-tunneling: once starting requirements at this position are met, the
  // personality preference multiplier collapses to zero.
  if (filledStarters) return 0;
  switch (persona) {
    case "hero-rb":
      if (pos === "RB") return round <= 2 ? 26 : round <= 6 ? -6 : 4;
      if (pos === "WR") return round <= 2 ? 4 : 18;
      return 0;
    case "zero-rb":
      if (pos === "RB") return round <= 2 ? -22 : round <= 4 ? -6 : 14;
      if (pos === "WR") return round <= 4 ? 20 : 6;
      if (pos === "TE") return round <= 4 ? 12 : 0;
      return 0;
    case "streamer":
      if (pos === "QB" || pos === "TE") return round <= 8 ? -20 : 12;
      if (pos === "RB" || pos === "WR") return round <= 8 ? 12 : 0;
      return 0;
    case "value":
    default:
      return 0;
  }
}

export type AiContext = {
  settings: Settings;
  /** Positions of the last picks made, most recent last. */
  recentPos: Pos[];
  /** Rosters keyed by 1-based team slot. */
  rosters: Map<number, Player[]>;
  /** Strategic profile per 1-based team slot. */
  personas: Record<string, Personality>;
  overall: number;
};

/**
 * Weighted, database-less AI selection: ADP value first, then personality,
 * roster constraints, positional runs, bye overlap and snipe awareness.
 */
export function aiPick(
  team: number,
  available: Player[],
  ctx: AiContext,
): Player | null {
  const { settings, rosters, recentPos, overall, personas } = ctx;
  const profile: Personality = personas[String(team)] ?? "value";
  const roster = rosters.get(team) ?? [];
  const round = Math.floor((overall - 1) / settings.teams) + 1;
  const lastTwoRounds = round > settings.rounds - 2;

  const have: Record<string, number> = {};
  for (const p of roster) have[p.pos] = (have[p.pos] ?? 0) + 1;

  // Positional run detection on QB/TE.
  const window = recentPos.slice(-4);
  const runPos = new Set<Pos>();
  for (const pos of ["QB", "TE"] as Pos[]) {
    if (window.filter((p) => p === pos).length >= 3) runPos.add(pos);
  }

  // Board snipe: does this team pick again immediately (snake turn)?
  const nextOwn = nextPickFor(team, overall + 1, settings);
  const backToBack = nextOwn !== null && nextOwn - overall <= 3;
  const intermediate: number[] = [];
  if (backToBack) {
    for (let o = overall + 1; o < nextOwn!; o++) {
      intermediate.push(teamForPick(o, settings.teams, settings.snake));
    }
  }

  let best: Player | null = null;
  let bestScore = -Infinity;
  const pool = available.slice(0, 90);
  const topAdp = pool.length ? value(pool[0]!, settings.scoring).adp : 0;

  for (const p of pool) {
    const v = value(p, settings.scoring);
    const adp = v.adp < 900 ? v.adp : 400;
    const count = have[p.pos] ?? 0;

    // Strict K/DEF block until the final two rounds.
    if ((p.pos === "K" || p.pos === "DEF") && !lastTwoRounds) continue;
    if (count >= HARD_CAP[p.pos]) continue;
    if ((settings.roster[p.pos] ?? 0) === 0 && (p.pos === "K" || p.pos === "DEF")) continue;

    // Overlap defense: never take a backup QB/TE sharing the starter's bye.
    if ((p.pos === "QB" || p.pos === "TE") && count >= 1) {
      const starter = roster.find((r) => r.pos === p.pos);
      if (starter?.bye && p.bye && starter.bye === p.bye) continue;
    }

    // Must fill remaining mandatory slots in the endgame.
    if (lastTwoRounds) {
      const missing = POSITIONS.filter(
        (pos) => (settings.roster[pos] ?? 0) > 0 && (have[pos] ?? 0) === 0,
      );
      if (missing.length && !missing.includes(p.pos)) continue;
    }

    const cap = starterCap(p.pos, settings);
    const filled = count >= Math.max(1, cap);

    // Base = ADP value with a tier-drop bonus when a slider is available.
    let score = -adp + (adp - topAdp < 6 ? 6 : 0);
    score += personalityWeight(profile, p.pos, round, filled);
    if (!filled) score += 8;
    if (runPos.has(p.pos)) score += 14;
    if (filled) score -= 6;

    // Snipe logic: if this team picks again soon and the teams in between
    // already have this position covered, wait and take flex value now.
    if (backToBack && intermediate.length) {
      const covered = intermediate.every((t) => {
        const r = rosters.get(t) ?? [];
        return r.filter((x) => x.pos === p.pos).length >= Math.max(1, starterCap(p.pos, settings));
      });
      if (covered && !FLEX_POSITIONS.includes(p.pos)) score -= 12;
    }

    // Value slide protection: a big ADP fall always stays attractive.
    score += Math.max(0, overall - adp) * 1.5;
    score += Math.random() * 4;

    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return best ?? available[0] ?? null;
}

function nextPickFor(team: number, from: number, settings: Settings): number | null {
  const total = settings.teams * settings.rounds;
  for (let o = from; o <= total; o++) {
    if (teamForPick(o, settings.teams, settings.snake) === team) return o;
  }
  return null;
}

/** Auto-pick for the human when the clock expires: best available for needs. */
export function autoPickForUser(
  available: Player[],
  roster: Player[],
  settings: Settings,
  overall: number,
): Player | null {
  const round = Math.floor((overall - 1) / settings.teams) + 1;
  const lastTwoRounds = round > settings.rounds - 2;
  const have: Record<string, number> = {};
  for (const p of roster) have[p.pos] = (have[p.pos] ?? 0) + 1;

  let best: Player | null = null;
  let bestScore = -Infinity;
  for (const p of available.slice(0, 120)) {
    const v = value(p, settings.scoring);
    const adp = v.adp < 900 ? v.adp : 400;
    const isKD = p.pos === "K" || p.pos === "DEF";
    const required = settings.roster[p.pos] ?? 0;
    const need = Math.max(0, starterCap(p.pos, settings) - (have[p.pos] ?? 0));
    let score = -adp + Math.min(need, 3) * 14 + Math.max(0, overall - adp) * 2.5;
    if (isKD) {
      if (required <= 0) continue;
      if (lastTwoRounds && (have[p.pos] ?? 0) === 0) score += 5000;
      else score -= 1000;
    }
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best ?? available[0] ?? null;
}
