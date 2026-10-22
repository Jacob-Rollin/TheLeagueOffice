import type { Pos } from "@/lib/draft";

/**
 * Soft fill colors for draft board cells + Team tab slot badges.
 * Pastels match the mobile mock-draft board (Sleeper-style chips).
 */
export const POS_CELL_BG: Record<string, string> = {
  QB: "bg-[#ffb3c1] text-[#1a1020]",
  RB: "bg-[#b8f0c8] text-[#102018]",
  WR: "bg-[#a8d8ff] text-[#0f1820]",
  TE: "bg-[#ffc896] text-[#1a140c]",
  K: "bg-[#d4b8ff] text-[#141018]",
  DEF: "bg-[#c4b4a4] text-[#181410]",
  DST: "bg-[#c4b4a4] text-[#181410]",
  /** Flex WRT — WR / RB / TE stripe (same pastels as above). */
  FLEX: "bg-gradient-to-r from-[#a8d8ff] via-[#b8f0c8] to-[#ffc896] text-[#102018]",
  /** Superflex — QB + flex stripe. */
  SUPER_FLEX: "bg-gradient-to-r from-[#ffb3c1] via-[#a8d8ff] to-[#ffc896] text-[#1a1020]",
  BN: "bg-[#8b97a8] text-[#101418]",
};

export const POS_DOT: Record<string, string> = {
  QB: "bg-[#ff8fab]",
  RB: "bg-[#5fd98a]",
  WR: "bg-[#5cb8ff]",
  TE: "bg-[#ff9f4a]",
  K: "bg-[#b48cff]",
  DEF: "bg-[#a08060]",
  DST: "bg-[#a08060]",
  FLEX: "bg-m-muted",
  SUPER_FLEX: "bg-m-muted",
  BN: "bg-slate-400",
};

export function posCellClass(pos: Pos | string | undefined): string {
  if (!pos) return "bg-m-card text-m-card-fg";
  return POS_CELL_BG[pos] ?? "bg-m-card text-m-card-fg";
}

/** Team-tab roster slot badge — colors by slot (empty or filled), not by player. */
export function posSlotBadgeClass(slot: string | undefined): string {
  if (!slot) return POS_CELL_BG["BN"]!;
  return POS_CELL_BG[slot] ?? POS_CELL_BG["BN"]!;
}
