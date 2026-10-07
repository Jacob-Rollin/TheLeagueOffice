/**
 * Standings analytics: Max PF / coaching efficiency from each completed week's best
 * possible lineup, and Monte Carlo playoff / title odds over the remaining schedule.
 */

export type AnalyticsWeekEntry = {
  rosterId: number;
  matchupId: number | null;
  points: number;
  starters: string[];
  playerIds: string[];
  irIds: string[];
  unstartableIds?: string[];
  playerPoints: Record<string, number>;
};

export type TeamAnalytics = {
  /** Points scored across completed weeks (matchup data). */
  pf: number;
  /** Best possible lineup each completed week, summed; null when rosters weren't available. */
  maxPf: number | null;
  /** pf / maxPf as a percentage. */
  efficiency: number | null;
  playoffPct: number | null;
  titlePct: number | null;
  /** First-round bye odds; null when every playoff team plays the first round. */
  byePct: number | null;
  /** Average regular-season wins across simulations (ties count half). */
  projectedWins: number | null;
  /** Regular-season games when the simulated season ends. */
  projectedGames: number | null;
  /** Average final seed by record. */
  projectedFinish: number | null;
  /** Week-to-week scoring spread used by the simulation. */
  weeklySd: number;
};

const SKIP_SLOTS = new Set(["BN", "BENCH", "IR", "IL", "TAXI", "RESERVE"]);

/** Positions a starting slot accepts. */
function slotEligibility(slot: string): string[] | null {
  switch (slot.trim().toUpperCase()) {
    case "QB":
    case "RB":
    case "WR":
    case "TE":
    case "K":
      return [slot.trim().toUpperCase()];
    case "DEF":
    case "DST":
    case "D/ST":
      return ["DEF"];
    case "FLEX":
    case "W/R/T":
    case "WRRBTE":
      return ["RB", "WR", "TE"];
    case "WRRB_FLEX":
    case "WRRB":
    case "RB/WR":
      return ["RB", "WR"];
    case "REC_FLEX":
    case "WRTE":
    case "WR/TE":
      return ["WR", "TE"];
    case "SUPER_FLEX":
    case "SUPERFLEX":
    case "SFLEX":
    case "Q/W/R/T":
      return ["QB", "RB", "WR", "TE"];
    default:
      return null;
  }
}

const DEFAULT_SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"];

export function starterSlots(rosterPositions: string[]): string[][] {
  const slots = rosterPositions
    .filter((slot) => slot && !SKIP_SLOTS.has(slot.trim().toUpperCase()))
    .map(slotEligibility)
    .filter((slot): slot is string[] => Boolean(slot));
  return (slots.length ? slots : DEFAULT_SLOTS.map((s) => slotEligibility(s)!))
    // Dedicated slots first so flex slots take the best leftovers.
    .sort((a, b) => a.length - b.length);
}

/** Best lineup total for one week. Greedy is exact for nested slots (single < flex < superflex). */
export function optimalLineupPoints(
  candidates: { id: string; pos: string; points: number }[],
  slots: string[][],
): number {
  const pool = [...candidates].sort((a, b) => b.points - a.points);
  const used = new Set<string>();
  let total = 0;
  for (const eligible of slots) {
    const pick = pool.find((c) => !used.has(c.id) && eligible.includes(c.pos));
    if (!pick) continue;
    used.add(pick.id);
    total += pick.points;
  }
  return total;
}

export type SlotDef = { label: string; eligible: string[] };

const FLEX_LABEL: Record<string, string> = {
  FLEX: "FLEX",
  "W/R/T": "FLEX",
  WRRBTE: "FLEX",
  WRRB_FLEX: "W/R",
  WRRB: "W/R",
  "RB/WR": "W/R",
  REC_FLEX: "W/T",
  WRTE: "W/T",
  "WR/TE": "W/T",
  SUPER_FLEX: "SFLEX",
  SUPERFLEX: "SFLEX",
  SFLEX: "SFLEX",
  "Q/W/R/T": "SFLEX",
};

/**
 * Offensive starting seats in roster order (kickers and defenses left out): QB1, RB1, RB2,
 * WR1, WR2, TE1, FLEX. Flex seats are numbered only when a league has more than one.
 */
export function offensiveSlotDefs(rosterPositions: string[]): SlotDef[] {
  const raw = rosterPositions.length ? rosterPositions : DEFAULT_SLOTS;
  const kept = raw
    .map((slot) => slot.trim().toUpperCase())
    .filter((slot) => !SKIP_SLOTS.has(slot))
    .map((slot) => ({ slot, eligible: slotEligibility(slot) }))
    .filter((s): s is { slot: string; eligible: string[] } => Boolean(s.eligible))
    .filter((s) => !(s.eligible.length === 1 && (s.eligible[0] === "K" || s.eligible[0] === "DEF")));
  const base = kept.map((s) => (s.eligible.length === 1 ? s.eligible[0]! : (FLEX_LABEL[s.slot] ?? "FLEX")));
  const totals = new Map<string, number>();
  for (const b of base) totals.set(b, (totals.get(b) ?? 0) + 1);
  const seen = new Map<string, number>();
  return kept.map((s, i) => {
    const b = base[i]!;
    const n = (seen.get(b) ?? 0) + 1;
    seen.set(b, n);
    const numbered = s.eligible.length === 1 || (totals.get(b) ?? 0) > 1;
    return { label: numbered ? `${b}${n}` : b, eligible: s.eligible };
  });
}

/** Who fills each seat (aligned with `defs`): dedicated seats first, flex seats take the best leftovers. */
export function assignLineup<T extends { id: string; pos: string; points: number }>(
  candidates: T[],
  defs: SlotDef[],
): (T | null)[] {
  const pool = [...candidates].sort((a, b) => b.points - a.points);
  const used = new Set<string>();
  const out: (T | null)[] = defs.map(() => null);
  const order = defs.map((d, i) => ({ d, i })).sort((a, b) => a.d.eligible.length - b.d.eligible.length);
  for (const { d, i } of order) {
    const pick = pool.find((c) => !used.has(c.id) && d.eligible.includes(c.pos));
    if (!pick) continue;
    used.add(pick.id);
    out[i] = pick;
  }
  return out;
}

function normalizePos(pos: string | null | undefined): string | null {
  const p = (pos ?? "").trim().toUpperCase();
  if (!p) return null;
  return p === "DST" || p === "D/ST" || p === "DEFENSE" ? "DEF" : p;
}

/**
 * Resolve a rostered player id to a fantasy position for Max PF.
 * Catalog miss fallback: Sleeper team defenses use the NFL abbrev as the id.
 */
export function resolveAnalyticsPos(
  playerId: string,
  posOf: (playerId: string) => string | null,
): string | null {
  const direct = normalizePos(posOf(playerId));
  if (direct) return direct;
  const abbr = String(playerId ?? "")
    .trim()
    .toUpperCase();
  // Sleeper D/ST ids are team abbreviations (e.g. "PHI", "WSH").
  if (/^[A-Z]{2,3}$/.test(abbr)) return "DEF";
  return null;
}

/**
 * One team's best possible lineup for a finished week, shared by the dashboard's Coaching
 * Efficiency and the standings so every page shows the same number. The pool is everyone who
 * scored for the team that week (IR included, matching StatChaser / FantasyPros), minus players
 * acquired after their game kicked off unless they were actually started.
 */
export function weeklyOptimalPoints(
  entry: Pick<AnalyticsWeekEntry, "starters" | "unstartableIds" | "playerPoints">,
  slots: string[][],
  posOf: (playerId: string) => string | null,
): number {
  const started = new Set((entry.starters ?? []).filter(Boolean));
  const unstartable = new Set(entry.unstartableIds ?? []);
  const candidates: { id: string; pos: string; points: number }[] = [];
  for (const [id, pts] of Object.entries(entry.playerPoints ?? {})) {
    if (!started.has(id) && unstartable.has(id)) continue;
    const pos = resolveAnalyticsPos(id, posOf);
    if (!pos) continue;
    candidates.push({ id, pos, points: Number(pts) || 0 });
  }
  return optimalLineupPoints(candidates, slots);
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed order for a bracket of `size` (power of two): [1, 8, 4, 5, 2, 7, 3, 6] for 8. */
function bracketOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((seed) => [seed, n + 1 - seed]);
  }
  return order;
}

export function computeStandingsAnalytics(input: {
  teams: { rosterId: number; wins: number; losses: number; ties: number; pointsFor: number }[];
  completedWeeks: AnalyticsWeekEntry[][];
  /** Remaining regular-season weeks; entries may be empty when the host has no schedule yet. */
  remainingWeeks: AnalyticsWeekEntry[][];
  rosterPositions: string[];
  posOf: (playerId: string) => string | null;
  playoffTeams: number;
  /** Per remaining week (aligned with `remainingWeeks`): rosterId -> projected best lineup. */
  projectedByWeek?: Map<number, number>[];
  /**
   * Share of each week's expected score taken from projections vs. scoring so far. Defaults to
   * projections only, which tracks StatChaser's odds; scoring so far fills in when a week has none.
   */
  projectionWeight?: number;
  simulations?: number;
}): Map<number, TeamAnalytics> {
  const { teams, completedWeeks, remainingWeeks, posOf } = input;
  const slots = starterSlots(input.rosterPositions);
  const ids = teams.map((t) => t.rosterId);
  const out = new Map<number, TeamAnalytics>();

  const pf = new Map<number, number>();
  const maxPf = new Map<number, number | null>();
  const scores = new Map<number, number[]>();
  for (const id of ids) {
    pf.set(id, 0);
    maxPf.set(id, slots.length ? 0 : null);
    scores.set(id, []);
  }

  for (const week of completedWeeks) {
    for (const entry of week) {
      const id = Number(entry.rosterId);
      if (!pf.has(id)) continue;
      const points = Number(entry.points) || 0;
      pf.set(id, pf.get(id)! + points);
      scores.get(id)!.push(points);

      const current = maxPf.get(id);
      if (current == null) continue;
      if (!Object.keys(entry.playerPoints ?? {}).length) {
        maxPf.set(id, null);
        continue;
      }
      maxPf.set(id, current + weeklyOptimalPoints(entry, slots, posOf));
    }
  }

  // Team strength: season scoring average shrunk toward the league mean while samples are small.
  const all = [...scores.values()].flat();
  const leagueMean = all.length ? all.reduce((s, v) => s + v, 0) / all.length : 110;
  // Week-to-week noise around each team's own average (between-team spread is the signal).
  let residual = 0;
  let dof = 0;
  for (const list of scores.values()) {
    if (list.length < 2) continue;
    const mean = list.reduce((s, v) => s + v, 0) / list.length;
    residual += list.reduce((s, v) => s + (v - mean) ** 2, 0);
    dof += list.length - 1;
  }
  const sd = dof >= 5 ? Math.min(32, Math.max(18, Math.sqrt(residual / dof))) : 25;
  const SHRINK_WEEKS = 3;
  const strength = new Map<number, number>();
  for (const id of ids) {
    const list = scores.get(id)!;
    const sum = list.reduce((s, v) => s + v, 0);
    strength.set(id, (sum + SHRINK_WEEKS * leagueMean) / (list.length + SHRINK_WEEKS));
  }

  const playoffTeams = Math.max(0, Math.min(input.playoffTeams, ids.length));
  const simCount = input.simulations ?? 5000;
  const madePlayoffs = new Map(ids.map((id) => [id, 0]));
  const wonTitle = new Map(ids.map((id) => [id, 0]));
  const gotBye = new Map(ids.map((id) => [id, 0]));
  const winTotals = new Map(ids.map((id) => [id, 0]));
  const seedTotals = new Map(ids.map((id) => [id, 0]));
  const bracketSize = playoffTeams > 0 ? 2 ** Math.ceil(Math.log2(Math.max(2, playoffTeams))) : 0;
  const byes = playoffTeams > 0 ? bracketSize - playoffTeams : 0;
  let simulatedWeeks = 0;

  if (playoffTeams > 0 && ids.length > 1) {
    const rand = mulberry32(ids.reduce((s, id) => s * 31 + id, 7) + completedWeeks.length);
    const normal = () => {
      let u = 0;
      while (u === 0) u = rand();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
    };
    const projectionWeight = Math.min(1, Math.max(0, input.projectionWeight ?? 1));
    const projected = input.projectedByWeek ?? [];
    const expected = (id: number, weekIndex: number | null): number => {
      const actual = strength.get(id)!;
      let proj: number | undefined;
      if (weekIndex == null) {
        // Playoffs: the roster's average projected week.
        const values = projected.map((m) => m.get(id)).filter((v): v is number => v != null);
        proj = values.length ? values.reduce((s, v) => s + v, 0) / values.length : undefined;
      } else {
        proj = projected[weekIndex]?.get(id);
      }
      return proj == null ? actual : projectionWeight * proj + (1 - projectionWeight) * actual;
    };
    const draw = (id: number, weekIndex: number | null = null) => expected(id, weekIndex) + sd * normal();

    const schedule = remainingWeeks.map((week) => {
      const byMatchup = new Map<number, number[]>();
      for (const entry of week) {
        if (entry.matchupId == null || !ids.includes(Number(entry.rosterId))) continue;
        const list = byMatchup.get(entry.matchupId) ?? [];
        list.push(Number(entry.rosterId));
        byMatchup.set(entry.matchupId, list);
      }
      const pairs = [...byMatchup.values()].filter((p) => p.length === 2) as [number, number][];
      return pairs.length ? pairs : null;
    });

    const base = new Map(teams.map((t) => [t.rosterId, t]));
    const order = bracketOrder(bracketSize);
    simulatedWeeks = schedule.length;

    for (let sim = 0; sim < simCount; sim += 1) {
      const wins = new Map(ids.map((id) => [id, (base.get(id)!.wins ?? 0) + (base.get(id)!.ties ?? 0) / 2]));
      const points = new Map(ids.map((id) => [id, base.get(id)!.pointsFor ?? 0]));

      for (let weekIndex = 0; weekIndex < schedule.length; weekIndex += 1) {
        const pairs = schedule[weekIndex]!;
        let games = pairs;
        if (!games) {
          const shuffled = [...ids].sort(() => rand() - 0.5);
          games = [];
          for (let i = 0; i + 1 < shuffled.length; i += 2) games.push([shuffled[i]!, shuffled[i + 1]!]);
        }
        for (const [a, b] of games) {
          const sa = draw(a, weekIndex);
          const sb = draw(b, weekIndex);
          points.set(a, points.get(a)! + sa);
          points.set(b, points.get(b)! + sb);
          wins.set(sa >= sb ? a : b, wins.get(sa >= sb ? a : b)! + 1);
        }
      }

      const seeded = [...ids].sort((a, b) => wins.get(b)! - wins.get(a)! || points.get(b)! - points.get(a)!);
      seeded.forEach((id, index) => {
        seedTotals.set(id, seedTotals.get(id)! + index + 1);
        winTotals.set(id, winTotals.get(id)! + wins.get(id)!);
      });
      const field = seeded.slice(0, playoffTeams);
      for (const id of field) madePlayoffs.set(id, madePlayoffs.get(id)! + 1);
      for (const id of field.slice(0, byes)) gotBye.set(id, gotBye.get(id)! + 1);

      // Top seeds take the byes when the field isn't a power of two.
      let round: (number | null)[] = order.map((seed) => field[seed - 1] ?? null);
      while (round.length > 1) {
        const next: (number | null)[] = [];
        for (let i = 0; i < round.length; i += 2) {
          const a = round[i] ?? null;
          const b = round[i + 1] ?? null;
          next.push(a == null ? b : b == null ? a : draw(a) >= draw(b) ? a : b);
        }
        round = next;
      }
      const champ = round[0];
      if (champ != null) wonTitle.set(champ, wonTitle.get(champ)! + 1);
    }
  }

  const simulated = playoffTeams > 0 && ids.length > 1;
  const record = new Map(teams.map((t) => [t.rosterId, t]));
  for (const id of ids) {
    const matchupPf = pf.get(id)!;
    const max = completedWeeks.length ? (maxPf.get(id) ?? null) : null;
    const t = record.get(id)!;
    // Sleeper start/sit % uses standings PF ÷ Max PF. Prefer host PF when it
    // lines up with the matchup slate we optimized (rounding noise only); if a
    // full week is missing from history, keep the matched matchup sum.
    const standingsPf = Number(t.pointsFor) || 0;
    const pfAligned =
      standingsPf > 0 && matchupPf > 0 && Math.abs(standingsPf - matchupPf) < 1;
    const effPf = pfAligned ? standingsPf : matchupPf;
    out.set(id, {
      pf: matchupPf,
      maxPf: max,
      efficiency: max && max > 0 ? Math.min(100, (effPf / max) * 100) : null,
      playoffPct: simulated ? (madePlayoffs.get(id)! / simCount) * 100 : null,
      titlePct: simulated ? (wonTitle.get(id)! / simCount) * 100 : null,
      byePct: simulated && byes > 0 ? (gotBye.get(id)! / simCount) * 100 : null,
      projectedWins: simulated ? winTotals.get(id)! / simCount : null,
      projectedGames: simulated ? (t.wins ?? 0) + (t.losses ?? 0) + (t.ties ?? 0) + simulatedWeeks : null,
      projectedFinish: simulated ? seedTotals.get(id)! / simCount : null,
      weeklySd: sd,
    });
  }
  return out;
}
