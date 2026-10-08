/**
 * Client-safe AI lineup ranking for native leagues (no DB / network).
 * Prefer healthy, non-bye starters; park IR-eligible sitters on IR.
 */

import type { RosterSlotKey } from "@/lib/league-settings";
import {
  buildDefaultLineupSlots,
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
  /** Lower is better (ADP / rank). */
  rank?: number | null;
};

/** True when the player should not start if a healthier option exists. */
export function isUnstartableThisWeek(
  meta: AiLineupPlayerMeta | undefined,
  week: number,
): boolean {
  if (!meta) return true;
  if (meta.bye != null && Number(meta.bye) === week) return true;
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

function startPriority(meta: AiLineupPlayerMeta | undefined, week: number): number {
  if (!meta) return -1e9;
  const rank = meta.rank != null && Number.isFinite(meta.rank) ? Number(meta.rank) : 400;
  let score = 1000 - Math.min(999, rank);
  if (isUnstartableThisWeek(meta, week)) score -= 10_000;
  const injury = String(meta.injury ?? "").toUpperCase();
  if (/\bQUESTIONABLE\b/.test(injury) || injury === "Q") score -= 40;
  return score;
}

/**
 * Build a lineup that avoids bye / Out / IR / Doubtful starters when possible.
 */
export function buildAiLineupSlots(input: {
  rosterPlayerIds: string[];
  metaById: Record<string, AiLineupPlayerMeta>;
  counts: Partial<Record<RosterSlotKey, number>>;
  week: number;
  irAllowedStatuses?: readonly NativeIrAllowedStatus[];
}): NativeLineupSlots {
  const allowed = input.irAllowedStatuses ?? DEFAULT_IR_ALLOWED_STATUSES;
  const ranked = [...input.rosterPlayerIds].sort(
    (a, b) =>
      startPriority(input.metaById[b], input.week) -
      startPriority(input.metaById[a], input.week),
  );

  const views = expandLineupSlots(input.counts);
  const remaining = [...ranked];

  const accept = (key: RosterSlotKey, id: string): boolean => {
    const meta = input.metaById[id];
    if (key === "IR") return playerEligibleForIr(meta?.injury, allowed);
    return slotAcceptsPos(key, meta?.pos ?? "");
  };

  const placeKeys = (keys: ReadonlySet<RosterSlotKey>, preferStartable: boolean) => {
    for (const row of views) {
      if (row.playerId || !keys.has(row.key)) continue;
      let idx = remaining.findIndex((id) => {
        if (!accept(row.key, id)) return false;
        if (!preferStartable) return true;
        return !isUnstartableThisWeek(input.metaById[id], input.week);
      });
      if (idx < 0 && preferStartable) {
        idx = remaining.findIndex((id) => accept(row.key, id));
      }
      if (idx < 0) continue;
      row.playerId = remaining.splice(idx, 1)[0] ?? null;
    }
  };

  placeKeys(new Set(["QB", "RB", "WR", "TE", "K", "DEF"]), true);
  placeKeys(new Set(["FLEX", "WRRB", "WRTE", "SFLEX"]), true);
  placeKeys(new Set(["IR"]), false);
  placeKeys(new Set(["BN", "TAXI"]), false);

  if (remaining.length === 0) {
    return slotsRecordFromViews(views);
  }

  // Ensure every rostered player is placed (validation requires full coverage).
  const posById: Record<string, string> = {};
  const injuryById: Record<string, string | null> = {};
  for (const id of input.rosterPlayerIds) {
    posById[id] = input.metaById[id]?.pos ?? "";
    injuryById[id] = input.metaById[id]?.injury ?? null;
  }
  return buildDefaultLineupSlots(ranked, posById, input.counts, {
    injuryById,
    irAllowedStatuses: allowed,
  });
}
