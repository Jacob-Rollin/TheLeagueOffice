import type { Player } from "@/lib/draft";
import type { BrainMatrix } from "@/lib/playerBrainHydration";
import { effectiveStarters, optimizeLineup, scaleValue } from "@/lib/trade-engine";

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
  /** Soft display band (55–100) for UI meters. */
  powerIndex: number;
  /**
   * League-relative 0–100 blend before the display band.
   * Prefer this for before/after grade math so #1 teams are not crushed by remorm.
   */
  strengthScore: number;
  marketValue: number;
  weeklyProjection: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  recordLabel: string;
};

/** Min/max anchors used to normalize power factors across the league. */
export type PowerNormScale = {
  market: { min: number; max: number };
  proj: { min: number; max: number };
  pf: { min: number; max: number };
};

/** Slots that are never starter seats (includes bench). */
const STARTER_SKIP_SLOTS = new Set(["BN", "BENCH", "IR", "IL", "TAXI", "RESERVE"]);

/**
 * Slots that do not count toward active roster capacity.
 * BN/BENCH (+ TAXI when listed) *do* count — only IR / IL / reserve are excluded.
 */
const CAP_SKIP_SLOTS = new Set(["IR", "IL", "RESERVE"]);

/** Count dedicated starter slots from a host league roster_positions template. */
export function starterRequirements(rosterPositions: string[]): Record<string, number> {
  const req: Record<string, number> = {};
  for (const raw of rosterPositions) {
    const pos = String(raw ?? "")
      .trim()
      .toUpperCase();
    if (!pos || STARTER_SKIP_SLOTS.has(pos)) continue;
    const key =
      pos === "SUPER_FLEX" || pos === "SUPERFLEX" || pos === "SFLEX" || pos === "Q/W/R/T"
        ? "SFLEX"
        : pos === "W/R/T" || pos === "WRRBTE"
          ? "FLEX"
          : pos === "DST" || pos === "D/ST"
            ? "DEF"
            : pos;
    if (!["QB", "RB", "WR", "TE", "FLEX", "SFLEX", "K", "DEF"].includes(key)) continue;
    req[key] = (req[key] ?? 0) + 1;
  }
  return effectiveStarters(req);
}

/**
 * Active roster spots (starters + bench), excluding IR/taxi, for overflow checks.
 *
 * Synced league `rosterPositions` are often starter-only (BN stripped upstream).
 * Pass `benchSlots` so capacity still includes bench when BN is absent from the list.
 */
export function leagueRosterCapFromPositions(
  rosterPositions: string[] | null | undefined,
  fallback: number,
  benchSlots = 0,
): number {
  if (!rosterPositions?.length) return fallback;
  let startersOrListed = 0;
  let listedBench = 0;
  for (const raw of rosterPositions) {
    const pos = String(raw ?? "")
      .trim()
      .toUpperCase();
    if (!pos || CAP_SKIP_SLOTS.has(pos)) continue;
    if (pos === "BN" || pos === "BENCH") {
      listedBench += 1;
      continue;
    }
    startersOrListed += 1;
  }
  const bench = listedBench > 0 ? listedBench : Math.max(0, Math.floor(benchSlots));
  const n = startersOrListed + bench;
  return n > 0 ? n : fallback;
}

/** Active (tradeable) roster bodies — exclude IR / IL designations. */
export function activeRosterCount(
  players: { id: string }[],
  irIds: Iterable<string> | null | undefined,
): number {
  if (!players.length) return 0;
  const ir = new Set(
    [...(irIds ?? [])].map((id) => String(id ?? "").trim()).filter(Boolean),
  );
  if (!ir.size) return players.length;
  return players.filter((p) => !ir.has(p.id)).length;
}

function boundsOf(values: number[]): { min: number; max: number } {
  if (!values.length) return { min: 0, max: 0 };
  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function normalizeWithBounds(values: number[], b: { min: number; max: number }): number[] {
  if (!values.length) return [];
  if (!Number.isFinite(b.min) || !Number.isFinite(b.max) || b.max === b.min) {
    return values.map(() => 50);
  }
  return values.map((v) => ((v - b.min) / (b.max - b.min)) * 100);
}

/**
 * Soft display band for the True Power Index.
 *
 * Pure 0–100 league min-max puts the weakest roster near 0 and reads much lower
 * than FantasyPros-style power ranks (often #1 = 100, mid teams still in the 70s–80s).
 * We keep continuous league-relative strength (not ordinal-only), then map into this
 * floor/ceil so the best team can hit 100 and mid/low teams stay readable.
 *
 * Positional / starter seat ranks (Standings Starting Slot Ranks) explain *why* a
 * team is strong — they already drive weekly optimal projection, so they are not
 * blended in again as a fourth weight (that would double-count starter strength).
 */
export const POWER_INDEX_FLOOR = 55;
export const POWER_INDEX_CEIL = 100;

/** Map a 0–100 relative blend into the soft FantasyPros-like display band. */
export function toDisplayPowerIndex(normalized0to100: number): number {
  const t = Math.max(0, Math.min(100, normalized0to100)) / 100;
  return Math.round((POWER_INDEX_FLOOR + t * (POWER_INDEX_CEIL - POWER_INDEX_FLOOR)) * 10) / 10;
}

function recordLabel(wins: number, losses: number, ties: number, pointsFor: number): string {
  const record = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
  const pf = Number.isFinite(pointsFor) ? pointsFor.toFixed(1) : "0.0";
  return `${record} | ${pf} PF`;
}

export type BuildPowerRankingsResult = {
  rows: PowerRankingRow[];
  /** League min/max anchors — freeze these when scoring after-trade power. */
  scale: PowerNormScale;
};

/**
 * Weighted Power Strength Index (Playbook True Power Rankings):
 * 40% roster market value + 40% optimal weekly projection + 20% season points for.
 * Each factor is min-max normalized across the league, then mapped into the soft
 * display band so indexes are not crushed toward zero for mid/low teams.
 *
 * Pass `freezeScale` (from a before-trade build) so after-trade strength stays on
 * the same axes — otherwise min-max re-runs and deltas are not comparable.
 */
export function buildTruePowerRankings(
  teams: PowerRankingInputs[],
  opts: {
    brain: BrainMatrix | null;
    projectFor: (playerId: string) => number | null;
    rosterPositions: string[];
    /** Reuse before-trade league mins/maxes for after-trade grading. */
    freezeScale?: PowerNormScale | null;
  },
): PowerRankingRow[] {
  return buildTruePowerRankingsDetailed(teams, opts).rows;
}

/** Same as `buildTruePowerRankings`, also returning the normalization scale. */
export function buildTruePowerRankingsDetailed(
  teams: PowerRankingInputs[],
  opts: {
    brain: BrainMatrix | null;
    projectFor: (playerId: string) => number | null;
    rosterPositions: string[];
    freezeScale?: PowerNormScale | null;
  },
): BuildPowerRankingsResult {
  if (!teams.length) {
    return {
      rows: [],
      scale: {
        market: { min: 0, max: 0 },
        proj: { min: 0, max: 0 },
        pf: { min: 0, max: 0 },
      },
    };
  }

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
      weekly:
        opts.projectFor(p.id) ??
        (!p.team || p.team.toUpperCase() === "FA" ? 0 : Math.max(0, (p.proj?.half ?? 0) / 17)),
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

  const scale: PowerNormScale = opts.freezeScale ?? {
    market: boundsOf(computed.map((r) => r.marketValue)),
    proj: boundsOf(computed.map((r) => r.weeklyProjection)),
    pf: boundsOf(computed.map((r) => r.pointsFor)),
  };

  const normMarket = normalizeWithBounds(
    computed.map((r) => r.marketValue),
    scale.market,
  );
  const normProj = normalizeWithBounds(
    computed.map((r) => r.weeklyProjection),
    scale.proj,
  );
  const normPf = normalizeWithBounds(
    computed.map((r) => r.pointsFor),
    scale.pf,
  );

  const ranked = computed
    .map((row, i) => {
      const blend = 0.4 * (normMarket[i] ?? 0) + 0.4 * (normProj[i] ?? 0) + 0.2 * (normPf[i] ?? 0);
      const strengthScore = Math.round(blend * 10) / 10;
      return {
        ...row,
        strengthScore,
        powerIndex: toDisplayPowerIndex(blend),
        recordLabel: recordLabel(row.wins, row.losses, row.ties, row.pointsFor),
      };
    })
    .sort((a, b) => b.strengthScore - a.strengthScore || b.pointsFor - a.pointsFor);

  const rows = ranked.map((row, index) => ({
    rank: index + 1,
    slot: row.slot,
    team: row.team,
    owner: row.owner,
    powerIndex: row.powerIndex,
    strengthScore: row.strengthScore,
    marketValue: Math.round(row.marketValue * 10) / 10,
    weeklyProjection: Math.round(row.weeklyProjection * 10) / 10,
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
    pointsFor: row.pointsFor,
    recordLabel: row.recordLabel,
  }));

  return { rows, scale };
}
