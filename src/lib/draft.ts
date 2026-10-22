import type { Player, Pos } from "./players.server";

export type { Player, Pos };

export type Scoring = "std" | "half" | "ppr";

export type RosterSlots = {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  FLEX: number;
  /** QB/RB/WR/TE — Superflex. Defaults to 0 when absent in older persisted settings. */
  SUPER_FLEX: number;
  K: number;
  DEF: number;
  BENCH: number;
};

export type Settings = {
  teams: number;
  rounds: number;
  myTeam: number; // 1-based draft slot
  scoring: Scoring;
  snake: boolean;
  roster: RosterSlots;
  teamNames: Record<string, string>;
};

export type Pick = {
  playerId: string;
  team: number; // 1-based
  overall: number; // 1-based
};

export const POSITIONS: Pos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
export const FLEX_POSITIONS: Pos[] = ["RB", "WR", "TE"];
export const SUPER_FLEX_POSITIONS: Pos[] = ["QB", "RB", "WR", "TE"];

/** UI label for filter chips / badges (internal pos stays DEF / SUPER_FLEX). */
export function posDisplayLabel(pos: string): string {
  if (pos === "DEF") return "DST";
  if (pos === "SUPER_FLEX") return "SF";
  return pos;
}

export const DEFAULT_ROSTER: RosterSlots = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  FLEX: 1,
  SUPER_FLEX: 0,
  K: 1,
  DEF: 1,
  BENCH: 6,
};

export function rosterSize(roster: RosterSlots): number {
  return Object.values(roster).reduce((a, b) => a + b, 0);
}

export const DEFAULT_SETTINGS: Settings = {
  teams: 12,
  rounds: rosterSize(DEFAULT_ROSTER),
  myTeam: 1,
  scoring: "half",
  snake: true,
  roster: DEFAULT_ROSTER,
  teamNames: {},
};

/** Display name for a 1-based team slot. */
export function teamName(settings: Settings, team: number): string {
  return settings.teamNames?.[String(team)]?.trim() || `Team ${team}`;
}

export const SCORING_LABEL: Record<Scoring, string> = {
  std: "Standard",
  half: "Half PPR",
  ppr: "Full PPR",
};

/** 1-based team that owns a given 1-based overall pick. */
export function teamForPick(overall: number, teams: number, snake: boolean): number {
  const round = Math.floor((overall - 1) / teams);
  const idx = (overall - 1) % teams;
  const reversed = snake && round % 2 === 1;
  return (reversed ? teams - 1 - idx : idx) + 1;
}

export function roundOf(overall: number, teams: number): number {
  return Math.floor((overall - 1) / teams) + 1;
}

export function nextPicksFor(
  team: number,
  fromOverall: number,
  settings: Settings,
  count = 2,
): number[] {
  const out: number[] = [];
  const total = settings.teams * settings.rounds;
  for (let o = fromOverall; o <= total && out.length < count; o++) {
    if (teamForPick(o, settings.teams, settings.snake) === team) out.push(o);
  }
  return out;
}

export function value(p: Player, scoring: Scoring) {
  return {
    adp: p.adp[scoring],
    rank: p.rank ? p.rank[scoring] : 999,
    proj: p.proj[scoring],
    prev: p.prev ? p.prev[scoring] : null,
  };
}

/**
 * Assign remaining flex (or superflex) demand to a single neediest position
 * so Suggested picks are not tripled across every flex-eligible spot.
 */
function assignSharedNeed(
  needs: Record<Pos, number>,
  have: Record<string, number>,
  eligible: Pos[],
  left: number,
) {
  if (left <= 0 || !eligible.length) return;
  let best = eligible[0]!;
  let bestScore = -Infinity;
  for (const pos of eligible) {
    // Prefer open dedicated needs; otherwise the sparsest rostered position.
    const score = needs[pos] * 100 - (have[pos] ?? 0);
    if (score > bestScore) {
      bestScore = score;
      best = pos;
    }
  }
  needs[best] += left;
}

/**
 * Remaining starting-lineup needs by position for a team, given who they have
 * already drafted. Shared FLEX / SUPER_FLEX demand is assigned once.
 */
export function positionNeeds(drafted: Player[], roster: RosterSlots): Record<Pos, number> {
  const have: Record<string, number> = {};
  for (const p of drafted) have[p.pos] = (have[p.pos] ?? 0) + 1;

  const needs = {} as Record<Pos, number>;
  let flexLeft = Math.max(0, roster.FLEX ?? 0);
  let superFlexLeft = Math.max(0, roster.SUPER_FLEX ?? 0);
  for (const pos of POSITIONS) {
    const dedicated = Math.max(0, roster[pos] ?? 0);
    const used = Math.min(have[pos] ?? 0, dedicated);
    needs[pos] = Math.max(0, dedicated - used);
  }
  // Spares beyond dedicated starters soak shared flex / superflex first.
  for (const pos of FLEX_POSITIONS) {
    const dedicated = Math.max(0, roster[pos] ?? 0);
    const spare = Math.max(0, (have[pos] ?? 0) - dedicated);
    const takeFlex = Math.min(spare, flexLeft);
    flexLeft -= takeFlex;
    const takeSf = Math.min(spare - takeFlex, superFlexLeft);
    superFlexLeft -= takeSf;
  }
  {
    const qbSpare = Math.max(0, (have.QB ?? 0) - Math.max(0, roster.QB ?? 0));
    const takeSf = Math.min(qbSpare, superFlexLeft);
    superFlexLeft -= takeSf;
  }
  assignSharedNeed(needs, have, FLEX_POSITIONS, flexLeft);
  assignSharedNeed(needs, have, SUPER_FLEX_POSITIONS, superFlexLeft);
  return needs;
}

/** Assign a roster of drafted players into starting slots + bench. */
export function fillRoster(players: Player[], roster: RosterSlots) {
  const slots: { slot: string; player: Player | null }[] = [];
  const pool = [...players];
  const take = (pos: Pos[]) => {
    const i = pool.findIndex((p) => pos.includes(p.pos));
    return i === -1 ? null : pool.splice(i, 1)[0]!;
  };
  const order: [keyof RosterSlots, Pos[]][] = [
    ["QB", ["QB"]],
    ["RB", ["RB"]],
    ["WR", ["WR"]],
    ["TE", ["TE"]],
    ["FLEX", FLEX_POSITIONS],
    ["SUPER_FLEX", SUPER_FLEX_POSITIONS],
    ["K", ["K"]],
    ["DEF", ["DEF"]],
  ];
  for (const [name, pos] of order) {
    const count = Math.max(0, roster[name] ?? 0);
    for (let i = 0; i < count; i++) slots.push({ slot: name, player: take(pos) });
  }
  for (let i = 0; i < Math.max(0, roster.BENCH ?? 0); i++) {
    slots.push({ slot: "BN", player: pool.shift() ?? null });
  }
  for (const extra of pool) slots.push({ slot: "BN", player: extra });
  return slots;
}

/** Snake drafts only — linear and auction are not snake. */
export function isSnakeDraft(type: string | null | undefined): boolean {
  const t = String(type ?? "snake").trim().toLowerCase();
  return t !== "linear" && t !== "auction";
}

/** Weeks 4-18 bye grid for a set of drafted players. */
export function byeMatrix(players: Player[]) {
  const weeks: number[] = [];
  for (let w = 4; w <= 14; w++) weeks.push(w);
  const byWeek = new Map<number, Player[]>();
  const unknown: Player[] = [];
  for (const p of players) {
    if (!p.bye) {
      unknown.push(p);
      continue;
    }
    if (!weeks.includes(p.bye)) weeks.push(p.bye);
    byWeek.set(p.bye, [...(byWeek.get(p.bye) ?? []), p]);
  }
  weeks.sort((a, b) => a - b);
  return {
    weeks: weeks.map((week) => {
      const list = (byWeek.get(week) ?? []).sort((a, b) => b.proj.half - a.proj.half);
      const posCounts: Record<string, number> = {};
      for (const p of list) posCounts[p.pos] = (posCounts[p.pos] ?? 0) + 1;
      const conflict = list.length >= 3 || Object.values(posCounts).some((n) => n >= 2);
      return { week, players: list, conflict };
    }),
    unknown,
  };
}
