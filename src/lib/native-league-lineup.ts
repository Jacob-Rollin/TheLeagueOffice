/**
 * Client-safe native lineup slot helpers (defaults + validation shapes).
 * Server enforces the same rules on save.
 */

import { ROSTER_SLOT_KEYS, type RosterSlotKey } from "@/lib/league-settings";
import {
  parseIrEligibility,
  type NativeIrEligibility,
} from "@/lib/native-league-settings";

export type NativeLineupSlots = Record<string, Array<string | null>>;

export type NativeLineupSlotView = {
  key: RosterSlotKey;
  index: number;
  label: string;
  playerId: string | null;
  starter: boolean;
};

const FLEX_ELIGIBLE = new Set(["RB", "WR", "TE"]);
const WRRB_ELIGIBLE = new Set(["WR", "RB"]);
const WRTE_ELIGIBLE = new Set(["WR", "TE"]);
const SFLEX_ELIGIBLE = new Set(["QB", "RB", "WR", "TE"]);

/** Designations that satisfy IR when league rule is injured_only. */
const IR_ELIGIBLE_STATUSES = new Set([
  "IR",
  "O",
  "OUT",
  "D",
  "DOUBTFUL",
  "PUP",
  "SUS",
  "SUSPENDED",
  "NA",
  "COVID-19",
  "COVID",
  "Q",
  "QUESTIONABLE",
]);

export function normalizePlayerPos(pos: string | null | undefined): string {
  const p = String(pos ?? "").trim().toUpperCase();
  if (p === "DST" || p === "D/ST" || p === "DEF") return "DEF";
  return p;
}

export function slotAcceptsPos(slot: RosterSlotKey, pos: string): boolean {
  const p = normalizePlayerPos(pos);
  if (!p) return false;
  if (slot === "BN" || slot === "IR" || slot === "TAXI") return true;
  if (slot === "FLEX") return FLEX_ELIGIBLE.has(p);
  if (slot === "WRRB") return WRRB_ELIGIBLE.has(p);
  if (slot === "WRTE") return WRTE_ELIGIBLE.has(p);
  if (slot === "SFLEX") return SFLEX_ELIGIBLE.has(p);
  if (slot === "DEF") return p === "DEF";
  return slot === p;
}

/** True when injury designation may occupy an IR lineup slot under injured_only. */
export function playerEligibleForIr(injuryStatus: string | null | undefined): boolean {
  const raw = String(injuryStatus ?? "").trim();
  if (!raw) return false;
  const upper = raw.toUpperCase();
  if (IR_ELIGIBLE_STATUSES.has(upper)) return true;
  // Sleeper sometimes returns "Questionable (Knee)" etc.
  for (const token of IR_ELIGIBLE_STATUSES) {
    if (upper.includes(token)) return true;
  }
  return false;
}

export function parseRosterSlotCounts(
  raw: Record<string, unknown> | null | undefined,
): Partial<Record<RosterSlotKey, number>> {
  const out: Partial<Record<RosterSlotKey, number>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of ROSTER_SLOT_KEYS) {
    const n = Math.floor(Number(raw[key] ?? 0));
    if (Number.isFinite(n) && n > 0) out[key] = n;
  }
  return out;
}

/** Active roster capacity (starters + BN + TAXI). IR does not add a free FA spot. */
export function countActiveRosterCapacity(
  counts: Partial<Record<RosterSlotKey, number>> | Record<string, unknown> | null | undefined,
): number {
  const parsed =
    counts && typeof counts === "object" && !Array.isArray(counts)
      ? parseRosterSlotCounts(counts as Record<string, unknown>)
      : {};
  let total = 0;
  for (const [key, n] of Object.entries(parsed)) {
    if (key === "IR") continue;
    if (typeof n === "number" && n > 0) total += n;
  }
  return total > 0 ? total : 15;
}

export function countIrSlots(
  counts: Partial<Record<RosterSlotKey, number>> | Record<string, unknown> | null | undefined,
): number {
  const parsed =
    counts && typeof counts === "object" && !Array.isArray(counts)
      ? parseRosterSlotCounts(counts as Record<string, unknown>)
      : {};
  return Math.max(0, Math.floor(Number(parsed.IR ?? 0)) || 0);
}

/** Expand slot counts into ordered empty slot rows (starters then BN/IR/TAXI). */
export function expandLineupSlots(
  counts: Partial<Record<RosterSlotKey, number>>,
): NativeLineupSlotView[] {
  const rows: NativeLineupSlotView[] = [];
  for (const key of ROSTER_SLOT_KEYS) {
    const n = Math.floor(Number(counts[key] ?? 0));
    if (!(n > 0)) continue;
    const starter = key !== "BN" && key !== "IR" && key !== "TAXI";
    for (let index = 0; index < n; index++) {
      const label =
        n > 1
          ? `${key === "DEF" ? "DST" : key}${index + 1}`
          : key === "DEF"
            ? "DST"
            : key;
      rows.push({ key, index, label, playerId: null, starter });
    }
  }
  return rows;
}

export function slotsRecordFromViews(views: NativeLineupSlotView[]): NativeLineupSlots {
  const out: NativeLineupSlots = {};
  for (const row of views) {
    const bucket = out[row.key] ?? [];
    while (bucket.length <= row.index) bucket.push(null);
    bucket[row.index] = row.playerId;
    out[row.key] = bucket;
  }
  return out;
}

export function viewsFromSlotsRecord(
  counts: Partial<Record<RosterSlotKey, number>>,
  slots: NativeLineupSlots | null | undefined,
): NativeLineupSlotView[] {
  const views = expandLineupSlots(counts);
  if (!slots || typeof slots !== "object") return views;
  for (const row of views) {
    const bucket = slots[row.key];
    if (!Array.isArray(bucket)) continue;
    const id = bucket[row.index];
    row.playerId = id == null || id === "" ? null : String(id);
  }
  return views;
}

/**
 * Greedy default: fill positional starters, then FLEX variants, then BN.
 * Unplaced players spill into BN then IR.
 */
export function buildDefaultLineupSlots(
  rosterPlayerIds: string[],
  posById: Record<string, string>,
  counts: Partial<Record<RosterSlotKey, number>>,
  options?: {
    injuryById?: Record<string, string | null | undefined>;
    irEligibility?: NativeIrEligibility;
  },
): NativeLineupSlots {
  const views = expandLineupSlots(counts);
  const remaining = [...rosterPlayerIds];
  const irRule = options?.irEligibility ?? "injured_only";
  const injuryById = options?.injuryById ?? {};

  const place = (pred: (key: RosterSlotKey) => boolean) => {
    for (const row of views) {
      if (row.playerId) continue;
      if (!pred(row.key)) continue;
      const idx = remaining.findIndex((id) => {
        if (!slotAcceptsPos(row.key, posById[id] ?? "")) return false;
        if (row.key === "IR" && irRule === "injured_only") {
          return playerEligibleForIr(injuryById[id]);
        }
        return true;
      });
      if (idx < 0) continue;
      row.playerId = remaining.splice(idx, 1)[0] ?? null;
    }
  };

  place((key) => key === "QB" || key === "RB" || key === "WR" || key === "TE" || key === "K" || key === "DEF");
  place((key) => key === "FLEX" || key === "WRRB" || key === "WRTE" || key === "SFLEX");
  place((key) => key === "BN");
  place((key) => key === "TAXI");
  place((key) => key === "IR");
  // Spill leftovers into BN if IR rejected them under injured_only.
  place((key) => key === "BN");

  return slotsRecordFromViews(views);
}

export function validateNativeLineupSlots(input: {
  slots: NativeLineupSlots;
  counts: Partial<Record<RosterSlotKey, number>>;
  rosterPlayerIds: string[];
  posById: Record<string, string>;
  /** Optional injury map for IR eligibility (catalog / Sleeper tokens). */
  injuryById?: Record<string, string | null | undefined>;
  irEligibility?: NativeIrEligibility;
}): { ok: true; slots: NativeLineupSlots } | { ok: false; error: string } {
  const views = viewsFromSlotsRecord(input.counts, input.slots);
  const rosterSet = new Set(input.rosterPlayerIds);
  const seen = new Set<string>();
  const irRule = input.irEligibility ?? "injured_only";

  for (const row of views) {
    const id = row.playerId;
    if (!id) continue;
    if (!rosterSet.has(id)) {
      return { ok: false, error: "Lineup includes a player not on your roster" };
    }
    if (seen.has(id)) {
      return { ok: false, error: "A player cannot fill more than one slot" };
    }
    seen.add(id);
    const pos = input.posById[id] ?? "";
    if (!slotAcceptsPos(row.key, pos)) {
      const label = row.key === "DEF" ? "DST" : row.key;
      return { ok: false, error: `${pos || "Player"} cannot start in ${label}` };
    }
    if (row.key === "IR" && irRule === "injured_only") {
      const injury = input.injuryById?.[id];
      if (!playerEligibleForIr(injury)) {
        return {
          ok: false,
          error: "Only injured / inactive players can fill IR under league settings",
        };
      }
    }
  }

  // Every rostered player must appear (no silent drops via lineup save).
  for (const id of input.rosterPlayerIds) {
    if (!seen.has(id)) {
      return { ok: false, error: "Every rostered player must be placed in a slot" };
    }
  }

  return { ok: true, slots: slotsRecordFromViews(views) };
}
