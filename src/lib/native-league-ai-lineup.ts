/**
 * Client-safe AI lineup ranking for native leagues (no DB / network).
 * Optimize by weekly projection when present; still prefer healthy, non-bye
 * starters and park IR-eligible sitters on IR.
 */

import type { RosterSlotKey } from "@/lib/league-settings";
import {
  classifyIrStatus,
  expandLineupSlots,
  playerEligibleForIr,
  slotAcceptsPos,
  slotsRecordFromViews,
  type NativeLineupSlots,
} from "@/lib/native-league-lineup";
import {
  DEFAULT_IR_ALLOWED_STATUSES,
  type NativeIrAllowedStatus,
} from "@/lib/native-league-settings";

export type AiLineupPlayerMeta = {
  pos: string;
  team?: string | null;
  bye?: number | null;
  injury?: string | null;
  /** Lower is better (ADP / rank). Used when weeklyProj is unavailable. */
  rank?: number | null;
  /** Weekly fantasy projection in league format — primary optimize signal. */
  weeklyProj?: number | null;
};

/** True when the player has no active NFL team (FA / unsigned / blank). */
export function hasNoNflTeam(meta: AiLineupPlayerMeta | undefined): boolean {
  if (!meta) return true;
  const team = String(meta.team ?? "")
    .trim()
    .toUpperCase();
  return !team || team === "FA" || team === "NONE" || team === "N/A";
}

/**
 * True when the player must not start this week (bye, no NFL team, Out / IR /
 * Doubtful / Suspended, etc.). AI never puts these in starter slots.
 */
export function isUnstartableThisWeek(
  meta: AiLineupPlayerMeta | undefined,
  week: number,
): boolean {
  if (!meta) return true;
  if (meta.bye != null && Number(meta.bye) === week) return true;
  if (hasNoNflTeam(meta)) return true;
  const injury = String(meta.injury ?? "").trim().toUpperCase();
  if (!injury) return false;
  if (
    /\bOUT\b/.test(injury) ||
    injury === "O" ||
    /\bDOUBTFUL\b/.test(injury) ||
    injury === "D" ||
    /\bIR\b/.test(injury) ||
    /\bINJURED RESERVE\b/.test(injury) ||
    /\bPUP\b/.test(injury) ||
    /\bSUSPEND/.test(injury) ||
    injury === "SUS" ||
    /\bNA\b/.test(injury) ||
    injury === "NA" ||
    /\bCOV\b/.test(injury) ||
    /\bDNR\b/.test(injury)
  ) {
    return true;
  }
  const classified = classifyIrStatus(meta.injury);
  if (classified === "IR" || classified === "NA" || classified === "Suspended") return true;
  return false;
}

/** Exported for tests — higher is better. */
export function aiStartPriority(meta: AiLineupPlayerMeta | undefined, week: number): number {
  if (!meta) return -1e9;
  const proj =
    meta.weeklyProj != null && Number.isFinite(Number(meta.weeklyProj))
      ? Number(meta.weeklyProj)
      : null;
  const rank = meta.rank != null && Number.isFinite(meta.rank) ? Number(meta.rank) : 400;
  // Weekly proj dominates ADP so AI lineups match Optimize; ADP is cold fallback.
  let score = proj != null ? proj * 100 : 1000 - Math.min(999, rank);
  if (isUnstartableThisWeek(meta, week)) score -= 10_000;
  const injury = String(meta.injury ?? "").toUpperCase();
  if (/\bQUESTIONABLE\b/.test(injury) || injury === "Q") score -= 40;
  return score;
}

const STARTER_POS_KEYS = new Set<RosterSlotKey>(["QB", "RB", "WR", "TE", "K", "DEF"]);
const STARTER_FLEX_KEYS = new Set<RosterSlotKey>(["FLEX", "WRRB", "WRTE", "SFLEX"]);

function isStarterSlotKey(key: RosterSlotKey): boolean {
  return STARTER_POS_KEYS.has(key) || STARTER_FLEX_KEYS.has(key);
}

/**
 * Build a projection-optimized lineup that never starts bye / FA / Out / IR /
 * Doubtful players. Empty starter holes stay empty so streamer FA/waivers can
 * fill them; leftovers spill to BN/TAXI only.
 *
 * Kickoff-locked players (same rules as human Optimize) stay in their previous
 * slots via `immovableIds` + `previousSlots` — AI never rearranges them.
 * Bye / no-team players are never treated as immovable pins into starters.
 */
export function buildAiLineupSlots(input: {
  rosterPlayerIds: string[];
  metaById: Record<string, AiLineupPlayerMeta>;
  counts: Partial<Record<RosterSlotKey, number>>;
  week: number;
  irAllowedStatuses?: readonly NativeIrAllowedStatus[];
  /** Player ids whose NFL game has locked — must keep previous placement. */
  immovableIds?: ReadonlySet<string>;
  /** Prior saved lineup used to pin immovable players. */
  previousSlots?: NativeLineupSlots | null;
}): NativeLineupSlots {
  const allowed = input.irAllowedStatuses ?? DEFAULT_IR_ALLOWED_STATUSES;
  // Bye / FA / Out players are never truly immovable — they must leave starter slots.
  const immovable = new Set(
    [...(input.immovableIds ?? [])].filter(
      (id) => !isUnstartableThisWeek(input.metaById[id], input.week),
    ),
  );
  const views = expandLineupSlots(input.counts);

  // Pin kickoff-locked (startable) players into their previous slots first.
  if (immovable.size > 0 && input.previousSlots) {
    for (const row of views) {
      const prevBucket = input.previousSlots[row.key];
      if (!Array.isArray(prevBucket)) continue;
      const prevId = prevBucket[row.index];
      const id = prevId == null || prevId === "" ? null : String(prevId);
      if (!id || !immovable.has(id)) continue;
      if (!input.rosterPlayerIds.includes(id)) continue;
      row.playerId = id;
    }
  }

  const pinned = new Set(
    views.map((v) => v.playerId).filter((id): id is string => Boolean(id)),
  );
  const ranked = input.rosterPlayerIds
    .filter((id) => !pinned.has(id) && !immovable.has(id))
    .sort(
      (a, b) =>
        aiStartPriority(input.metaById[b], input.week) -
        aiStartPriority(input.metaById[a], input.week),
    );

  const remaining = [...ranked];

  const accept = (key: RosterSlotKey, id: string): boolean => {
    const meta = input.metaById[id];
    if (key === "IR") return playerEligibleForIr(meta?.injury, allowed);
    return slotAcceptsPos(key, meta?.pos ?? "");
  };

  /** Starter placement: startable players only — never fall back to bye/FA/Out. */
  const placeStartable = (keys: ReadonlySet<RosterSlotKey>) => {
    for (const row of views) {
      if (row.playerId || !keys.has(row.key)) continue;
      const idx = remaining.findIndex(
        (id) =>
          accept(row.key, id) && !isUnstartableThisWeek(input.metaById[id], input.week),
      );
      if (idx < 0) continue;
      row.playerId = remaining.splice(idx, 1)[0] ?? null;
    }
  };

  const placeAny = (keys: ReadonlySet<RosterSlotKey>) => {
    for (const row of views) {
      if (row.playerId || !keys.has(row.key)) continue;
      const idx = remaining.findIndex((id) => accept(row.key, id));
      if (idx < 0) continue;
      row.playerId = remaining.splice(idx, 1)[0] ?? null;
    }
  };

  placeStartable(STARTER_POS_KEYS);
  placeStartable(STARTER_FLEX_KEYS);
  placeAny(new Set(["IR"]));
  placeAny(new Set(["BN", "TAXI"]));

  if (remaining.length === 0) {
    return slotsRecordFromViews(views);
  }

  // Spill leftovers into BN/TAXI only — never dump bye/FA into empty starters.
  for (const id of remaining.splice(0)) {
    const open = views.find((row) => !row.playerId && (row.key === "BN" || row.key === "TAXI"));
    if (open) {
      open.playerId = id;
      continue;
    }
    // Overflow: only startable players may occupy leftover starter holes.
    if (!isUnstartableThisWeek(input.metaById[id], input.week)) {
      const starterOpen = views.find(
        (row) => !row.playerId && isStarterSlotKey(row.key) && accept(row.key, id),
      );
      if (starterOpen) {
        starterOpen.playerId = id;
      }
    }
  }

  return slotsRecordFromViews(views);
}
