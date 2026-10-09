/**
 * Client-safe native lineup slot helpers (defaults + validation shapes).
 * Server enforces the same rules on save.
 */

import { ROSTER_SLOT_KEYS, type RosterSlotKey } from "@/lib/league-settings";
import {
  DEFAULT_IR_ALLOWED_STATUSES,
  type NativeIrAllowedStatus,
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

/**
 * Map a Sleeper/catalog injury string to a commissioner IR allow-list token.
 * Q / Doubtful / Out intentionally return null (never IR-eligible).
 */
export function classifyIrStatus(
  injuryStatus: string | null | undefined,
): NativeIrAllowedStatus | null {
  const raw = String(injuryStatus ?? "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();

  // Explicitly reject these even when they appear beside other words.
  if (
    /\bQUESTIONABLE\b/.test(upper) ||
    /\bDOUBTFUL\b/.test(upper) ||
    /(^|[^A-Z])OUT([^A-Z]|$)/.test(upper) ||
    upper === "Q" ||
    upper === "D" ||
    upper === "O"
  ) {
    // Suspended / NA / IR take precedence when clearly present.
    if (/\bSUSPEND/.test(upper) || upper === "SUS") return "Suspended";
    if (/\bNA\b/.test(upper) || upper === "NA") return "NA";
    if (/(^|[^A-Z])IR([^A-Z]|$)/.test(upper) || /\bINJURED RESERVE\b/.test(upper)) return "IR";
    return null;
  }

  if (/\bSUSPEND/.test(upper) || upper === "SUS") return "Suspended";
  if (/\bNA\b/.test(upper) || upper === "NA") return "NA";
  if (/(^|[^A-Z])IR([^A-Z]|$)/.test(upper) || /\bINJURED RESERVE\b/.test(upper)) return "IR";
  return null;
}

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

/** True when the player's designation is in the league's IR allow-list. */
export function playerEligibleForIr(
  injuryStatus: string | null | undefined,
  allowed: readonly NativeIrAllowedStatus[] = DEFAULT_IR_ALLOWED_STATUSES,
): boolean {
  const classified = classifyIrStatus(injuryStatus);
  if (!classified) return false;
  return allowed.includes(classified);
}

/** Players currently in IR slots who no longer match commissioner settings. */
export function findIneligibleIrOccupants(
  views: NativeLineupSlotView[],
  injuryById: Record<string, string | null | undefined>,
  allowed: readonly NativeIrAllowedStatus[],
): Array<{ playerId: string; injury: string | null; slotIndex: number }> {
  const out: Array<{ playerId: string; injury: string | null; slotIndex: number }> = [];
  for (const row of views) {
    if (row.key !== "IR" || !row.playerId) continue;
    const injury = injuryById[row.playerId] ?? null;
    if (!playerEligibleForIr(injury, allowed)) {
      out.push({ playerId: row.playerId, injury, slotIndex: row.index });
    }
  }
  return out;
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

/** True when any starter/bench/IR bucket has a player id. */
export function nativeSlotsHavePlayers(slots: NativeLineupSlots | null | undefined): boolean {
  if (!slots || typeof slots !== "object") return false;
  for (const bucket of Object.values(slots)) {
    if (!Array.isArray(bucket)) continue;
    if (bucket.some((id) => id != null && String(id).trim() !== "")) return true;
  }
  return false;
}

/**
 * Flatten starter ids in ROSTER_SLOT_KEYS order (QB→…→DEF).
 * Never use Object.entries — MySQL/TiDB JSON often returns keys alphabetically,
 * which misaligns matchup rows (e.g. DEF painted in the QB slot).
 */
export function starterIdsFromNativeSlots(slotsRaw: unknown): string[] {
  let slots: unknown = slotsRaw;
  if (typeof slotsRaw === "string") {
    try {
      slots = JSON.parse(slotsRaw);
    } catch {
      return [];
    }
  }
  if (!slots || typeof slots !== "object" || Array.isArray(slots)) return [];
  const record = slots as Record<string, unknown>;
  const out: string[] = [];
  for (const key of ROSTER_SLOT_KEYS) {
    if (key === "BN" || key === "IR" || key === "TAXI") continue;
    const bucket = record[key];
    if (!Array.isArray(bucket)) continue;
    for (const id of bucket) {
      if (id == null || id === "") continue;
      out.push(String(id));
    }
  }
  return out;
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
    irAllowedStatuses?: readonly NativeIrAllowedStatus[];
  },
): NativeLineupSlots {
  const views = expandLineupSlots(counts);
  const remaining = [...rosterPlayerIds];
  const allowed = options?.irAllowedStatuses ?? DEFAULT_IR_ALLOWED_STATUSES;
  const injuryById = options?.injuryById ?? {};

  const place = (pred: (key: RosterSlotKey) => boolean) => {
    for (const row of views) {
      if (row.playerId) continue;
      if (!pred(row.key)) continue;
      const idx = remaining.findIndex((id) => {
        if (!slotAcceptsPos(row.key, posById[id] ?? "")) return false;
        if (row.key === "IR") return playerEligibleForIr(injuryById[id], allowed);
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
  // Spill leftovers into BN if IR rejected them.
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
  irAllowedStatuses?: readonly NativeIrAllowedStatus[];
}): { ok: true; slots: NativeLineupSlots } | { ok: false; error: string } {
  const views = viewsFromSlotsRecord(input.counts, input.slots);
  const rosterSet = new Set(input.rosterPlayerIds);
  const seen = new Set<string>();
  const allowed = input.irAllowedStatuses ?? DEFAULT_IR_ALLOWED_STATUSES;

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
    if (row.key === "IR") {
      const injury = input.injuryById?.[id];
      if (!playerEligibleForIr(injury, allowed)) {
        const allowedLabel = allowed.join(", ");
        return {
          ok: false,
          error: `IR is limited to ${allowedLabel}. Move or drop players who no longer qualify.`,
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

/** Split validated lineup into active roster ids vs IR reserve. */
export function splitActiveAndIrFromSlots(slots: NativeLineupSlots): {
  activePlayerIds: string[];
  irPlayerIds: string[];
} {
  const irPlayerIds: string[] = [];
  const activePlayerIds: string[] = [];
  for (const [key, bucket] of Object.entries(slots)) {
    if (!Array.isArray(bucket)) continue;
    for (const id of bucket) {
      if (!id) continue;
      if (key === "IR") irPlayerIds.push(id);
      else activePlayerIds.push(id);
    }
  }
  return { activePlayerIds, irPlayerIds };
}
