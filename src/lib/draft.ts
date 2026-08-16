import type { Player, Pos } from "./players.server";

export type { Player, Pos };

export type Scoring = "std" | "half" | "ppr";

export type RosterSlots = {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  FLEX: number;
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
};

export type Pick = {
  playerId: string;
  team: number; // 1-based
  overall: number; // 1-based
};

export const POSITIONS: Pos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
export const FLEX_POSITIONS: Pos[] = ["RB", "WR", "TE"];

export const DEFAULT_ROSTER: RosterSlots = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  FLEX: 1,
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
};

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
  return { adp: p.adp[scoring], proj: p.proj[scoring], prev: p.prev ? p.prev[scoring] : null };
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
    ["K", ["K"]],
    ["DEF", ["DEF"]],
  ];
  for (const [name, pos] of order) {
    for (let i = 0; i < roster[name]; i++) slots.push({ slot: name, player: take(pos) });
  }
  for (let i = 0; i < roster.BENCH; i++) slots.push({ slot: "BN", player: pool.shift() ?? null });
  for (const extra of pool) slots.push({ slot: "BN", player: extra });
  return slots;
}
