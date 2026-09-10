import type { Player } from "@/lib/draft";
import type { BrainMatrix } from "@/lib/playerBrainHydration";
import { BASE_STARTERS, optimizeLineup, scaleValue } from "@/lib/trade-engine";

export type PowerRankingInputs = {
  slot: number;
  team: string;
  owner: string;
  players: Player[];
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
};

export type PowerRankingRow = {
  rank: number;
  slot: number;
  team: string;
  owner: string;
  powerIndex: number;
  marketValue: number;
  weeklyProjection: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  recordLabel: string;
};

const SKIP_SLOTS = new Set(["BN", "BENCH", "IR", "IL", "TAXI", "RESERVE"]);

/** Count dedicated starter slots from a host league roster_positions template. */
export function starterRequirements(rosterPositions: string[]): Record<string, number> {
  const req: Record<string, number> = {};
  for (const raw of rosterPositions) {
    const pos = String(raw ?? "")
      .trim()
      .toUpperCase();
    if (!pos || SKIP_SLOTS.has(pos)) continue;
    const key =
      pos === "SUPER_FLEX" || pos === "SUPERFLEX" || pos === "Q/W/R/T"
        ? "FLEX"
        : pos === "W/R/T" || pos === "WRRBTE"
          ? "FLEX"
          : pos;
    if (!["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"].includes(key)) continue;
    req[key] = (req[key] ?? 0) + 1;
  }
  return Object.keys(req).length ? req : { ...BASE_STARTERS };
}

function minMaxNormalize(values: number[]): number[] {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) {
    return values.map(() => 50);
  }
  return values.map((v) => ((v - min) / (max - min)) * 100);
}

function recordLabel(wins: number, losses: number, ties: number, pointsFor: number): string {
  const record = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
  const pf = Number.isFinite(pointsFor) ? pointsFor.toFixed(1) : "0.0";
  return `${record} | ${pf} PF`;
}

/**
 * Weighted Power Strength Index:
 * 40% roster market value + 40% optimal weekly projection + 20% season points for.
 * Each factor is min-max normalized across the league before weighting.
 */
export function buildTruePowerRankings(
  teams: PowerRankingInputs[],
  opts: {
    brain: BrainMatrix | null;
    projectFor: (playerId: string) => number | null;
    rosterPositions: string[];
  },
): PowerRankingRow[] {
  if (!teams.length) return [];

  const starters = starterRequirements(opts.rosterPositions);
  const scoring = { weeklyFor: opts.projectFor };

  const computed = teams.map((team) => {
    const marketRaw = team.players.reduce((sum, p) => {
      const value = opts.brain?.[p.id]?.value;
      return sum + (typeof value === "number" && Number.isFinite(value) ? value : 0);
    }, 0);
    const marketValue = scaleValue(marketRaw);

    const fitPlayers = team.players.map((p) => ({
      id: p.id,
      pos: p.pos,
      weekly: opts.projectFor(p.id) ?? Math.max(0, (p.proj?.half ?? 0) / 17),
    }));
    const weeklyProjection = optimizeLineup(fitPlayers, starters, scoring).points;

    return {
      slot: team.slot,
      team: team.team,
      owner: team.owner,
      marketValue,
      weeklyProjection,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      pointsFor: team.pointsFor,
    };
  });

  const normMarket = minMaxNormalize(computed.map((r) => r.marketValue));
  const normProj = minMaxNormalize(computed.map((r) => r.weeklyProjection));
  const normPf = minMaxNormalize(computed.map((r) => r.pointsFor));

  const ranked = computed
    .map((row, i) => ({
      ...row,
      powerIndex: 0.4 * (normMarket[i] ?? 0) + 0.4 * (normProj[i] ?? 0) + 0.2 * (normPf[i] ?? 0),
      recordLabel: recordLabel(row.wins, row.losses, row.ties, row.pointsFor),
    }))
    .sort((a, b) => b.powerIndex - a.powerIndex || b.pointsFor - a.pointsFor);

  return ranked.map((row, index) => ({
    rank: index + 1,
    slot: row.slot,
    team: row.team,
    owner: row.owner,
    powerIndex: Math.round(row.powerIndex * 10) / 10,
    marketValue: Math.round(row.marketValue * 10) / 10,
    weeklyProjection: Math.round(row.weeklyProjection * 10) / 10,
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
    pointsFor: row.pointsFor,
    recordLabel: row.recordLabel,
  }));
}
