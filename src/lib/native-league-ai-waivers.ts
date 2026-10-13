/**
 * Client-safe AI waiver / FA planning for native leagues.
 * Fill any starter hole (bye / Out / missing) via add+drop — not just K/DEF.
 */

import type { RosterSlotKey } from "@/lib/league-settings";
import {
  expandLineupSlots,
  slotAcceptsPos,
} from "@/lib/native-league-lineup";
import {
  aiStartPriority,
  isUnstartableThisWeek,
  type AiLineupPlayerMeta,
} from "@/lib/native-league-ai-lineup";

export type AiStreamerPos = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

const STREAMER_POS: readonly AiStreamerPos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

/** Max add/drop plans per team per tick (covers multi-hole bye weeks). */
export const AI_STREAMER_MAX_PLANS = 6;

export type AiStreamerClaimPlan = {
  pos: AiStreamerPos;
  addPlayerId: string;
  /** Bye / Out / missing-slot drop; null when roster has an open active slot. */
  dropPlayerId: string | null;
  reason: "bye" | "out" | "missing";
};

function normalizePos(pos: string | null | undefined): string {
  const p = String(pos ?? "").trim().toUpperCase();
  if (p === "DST" || p === "D/ST") return "DEF";
  return p;
}

function asStreamerPos(pos: string | null | undefined): AiStreamerPos | null {
  const p = normalizePos(pos);
  return (STREAMER_POS as readonly string[]).includes(p) ? (p as AiStreamerPos) : null;
}

function rankValue(meta: AiLineupPlayerMeta | undefined): number {
  if (!meta) return -1e9;
  const proj =
    meta.weeklyProj != null && Number.isFinite(Number(meta.weeklyProj))
      ? Number(meta.weeklyProj)
      : null;
  if (proj != null) return proj * 100;
  const rank = meta.rank != null && Number.isFinite(meta.rank) ? Number(meta.rank) : 400;
  return 1000 - Math.min(999, rank);
}

function reasonForUnstartable(
  meta: AiLineupPlayerMeta | undefined,
  week: number,
): "bye" | "out" | "missing" {
  if (!meta) return "missing";
  if (meta.bye != null && Number(meta.bye) === week) return "bye";
  return "out";
}

function starterViews(starterNeeds: Partial<Record<RosterSlotKey, number>>) {
  return expandLineupSlots(starterNeeds).filter((row) => row.starter);
}

/**
 * True when every starter slot can be filled with a startable (non-bye / non-Out) player.
 */
export function canFillStartingLineup(
  rosterPlayerIds: string[],
  metaById: Record<string, AiLineupPlayerMeta>,
  starterNeeds: Partial<Record<RosterSlotKey, number>>,
  week: number,
): boolean {
  const views = starterViews(starterNeeds);
  if (views.length === 0) return true;
  const remaining = rosterPlayerIds
    .filter((id) => !isUnstartableThisWeek(metaById[id], week))
    .sort(
      (a, b) =>
        aiStartPriority(metaById[b], week) - aiStartPriority(metaById[a], week) ||
        a.localeCompare(b),
    );

  // Dedicated slots first, then flex variants (matches AI lineup place order).
  const place = (keys: ReadonlySet<RosterSlotKey>) => {
    for (const row of views) {
      if (row.playerId || !keys.has(row.key)) continue;
      const idx = remaining.findIndex((id) =>
        slotAcceptsPos(row.key, metaById[id]?.pos ?? ""),
      );
      if (idx < 0) return false;
      row.playerId = remaining.splice(idx, 1)[0] ?? null;
    }
    return true;
  };

  if (!place(new Set(["QB", "RB", "WR", "TE", "K", "DEF"]))) return false;
  if (!place(new Set(["FLEX", "WRRB", "WRTE", "SFLEX"]))) return false;
  return views.every((row) => Boolean(row.playerId));
}

/** First unfilled starter slot's preferred add positions (dedicated pos or flex pool). */
function nextHolePreferredPositions(
  rosterPlayerIds: string[],
  metaById: Record<string, AiLineupPlayerMeta>,
  starterNeeds: Partial<Record<RosterSlotKey, number>>,
  week: number,
): AiStreamerPos[] | null {
  const views = starterViews(starterNeeds);
  const remaining = rosterPlayerIds
    .filter((id) => !isUnstartableThisWeek(metaById[id], week))
    .sort(
      (a, b) =>
        aiStartPriority(metaById[b], week) - aiStartPriority(metaById[a], week) ||
        a.localeCompare(b),
    );

  const tryPlace = (keys: ReadonlySet<RosterSlotKey>): RosterSlotKey | null => {
    for (const row of views) {
      if (row.playerId || !keys.has(row.key)) continue;
      const idx = remaining.findIndex((id) =>
        slotAcceptsPos(row.key, metaById[id]?.pos ?? ""),
      );
      if (idx < 0) return row.key;
      row.playerId = remaining.splice(idx, 1)[0] ?? null;
    }
    return null;
  };

  const hole =
    tryPlace(new Set(["QB", "RB", "WR", "TE", "K", "DEF"])) ??
    tryPlace(new Set(["FLEX", "WRRB", "WRTE", "SFLEX"]));
  if (!hole) return null;

  if (hole === "FLEX") return ["RB", "WR", "TE"];
  if (hole === "WRRB") return ["RB", "WR"];
  if (hole === "WRTE") return ["WR", "TE"];
  if (hole === "SFLEX") return ["QB", "RB", "WR", "TE"];
  const dedicated = asStreamerPos(hole);
  return dedicated ? [dedicated] : ["RB", "WR", "TE"];
}

function countStartableAtPos(
  rosterPlayerIds: string[],
  metaById: Record<string, AiLineupPlayerMeta>,
  pos: AiStreamerPos,
  week: number,
  excludeIds: ReadonlySet<string>,
): number {
  return rosterPlayerIds.filter(
    (id) =>
      !excludeIds.has(id) &&
      normalizePos(metaById[id]?.pos) === pos &&
      !isUnstartableThisWeek(metaById[id], week),
  ).length;
}

function dedicatedNeed(
  starterNeeds: Partial<Record<RosterSlotKey, number>>,
  pos: AiStreamerPos,
): number {
  return Math.max(0, Math.floor(Number(starterNeeds[pos] ?? 0) || 0));
}

/**
 * Plan add/drops so AI teams can field a full startable lineup.
 * Drops prefer bye/Out / least effective players while protecting
 * this-week fill and next-week positional depth.
 */
export function planAiStreamerClaims(input: {
  week: number;
  rosterPlayerIds: string[];
  metaById: Record<string, AiLineupPlayerMeta>;
  /** Free-agent candidates (any streamer pos; filtered inside). */
  freeAgents: Array<{ id: string; meta: AiLineupPlayerMeta }>;
  starterNeeds: Partial<Record<RosterSlotKey, number>>;
  /**
   * Active (non-IR) roster size. When `>= rosterCapacity`, every add must
   * include a drop — same rule as human FA / waiver processing.
   */
  activeRosterCount: number;
  /** Active roster capacity (starters + bench + taxi; IR excluded). */
  rosterCapacity: number;
  /**
   * @deprecated Prefer activeRosterCount + rosterCapacity. Still honored when
   * capacity fields are omitted by older callers.
   */
  requiresDrop?: boolean;
  /**
   * Kickoff-locked roster ids (same as human lineup/FA rules) — never drop these.
   */
  lockedPlayerIds?: ReadonlySet<string>;
}): AiStreamerClaimPlan[] {
  const week = Math.max(1, Math.min(18, Math.floor(input.week) || 1));
  const nextWeek = Math.min(18, week + 1);
  const locked = input.lockedPlayerIds ?? new Set<string>();
  const plans: AiStreamerClaimPlan[] = [];
  const reservedAdds = new Set<string>();
  const reservedDrops = new Set<string>();
  // Include FA metas so add ids resolve during can-fill / working-set checks.
  const metaById: Record<string, AiLineupPlayerMeta> = { ...input.metaById };
  for (const fa of input.freeAgents) {
    if (!metaById[fa.id]) metaById[fa.id] = fa.meta;
  }
  let working = input.rosterPlayerIds.filter((id) => !reservedDrops.has(id));
  const capacity = Math.max(
    1,
    Math.floor(
      Number.isFinite(input.rosterCapacity)
        ? Number(input.rosterCapacity)
        : input.rosterPlayerIds.length,
    ) || 1,
  );
  let workingActive = Math.max(
    0,
    Math.floor(
      Number.isFinite(input.activeRosterCount)
        ? Number(input.activeRosterCount)
        : input.rosterPlayerIds.length,
    ) || 0,
  );

  const pickAdd = (preferred: AiStreamerPos[]): { id: string; pos: AiStreamerPos } | null => {
    const preferredSet = new Set(preferred);
    const ranked = input.freeAgents
      .filter((fa) => {
        if (reservedAdds.has(fa.id)) return false;
        const pos = asStreamerPos(fa.meta.pos);
        if (!pos || !preferredSet.has(pos)) return false;
        return !isUnstartableThisWeek(fa.meta, week);
      })
      .sort(
        (a, b) =>
          rankValue(b.meta) - rankValue(a.meta) || a.id.localeCompare(b.id),
      );
    const best = ranked[0];
    if (!best) return null;
    const pos = asStreamerPos(best.meta.pos);
    if (!pos) return null;
    return { id: best.id, pos };
  };

  const pickDrop = (
    roster: string[],
    addId: string,
    addPos: AiStreamerPos,
    mustDrop: boolean,
  ): { id: string | null; reason: "bye" | "out" | "missing" } => {
    if (!mustDrop) return { id: null, reason: "missing" };

    type Cand = {
      id: string;
      score: number;
      nextOk: boolean;
      reason: "bye" | "out" | "missing";
    };
    const candidates: Cand[] = [];

    for (const id of roster) {
      if (reservedDrops.has(id) || locked.has(id) || id === addId) continue;
      const meta = metaById[id];
      const after = roster.filter((x) => x !== id).concat(addId);
      // Must still field a full startable lineup this week after the swap.
      if (!canFillStartingLineup(after, metaById, input.starterNeeds, week)) {
        continue;
      }
      const nextOk = canFillStartingLineup(after, metaById, input.starterNeeds, nextWeek);
      const dropPos = asStreamerPos(meta?.pos);
      let score = 0;

      // Prefer dumping the unstartable piece we're replacing.
      if (isUnstartableThisWeek(meta, week)) {
        score += 500;
        if (dropPos === addPos) score += 300;
      }
      // Soft preference: also sitting next week (less useful soon).
      if (isUnstartableThisWeek(meta, nextWeek)) score += 80;

      // Prefer dropping surplus depth at a position (keep scarce pieces).
      if (dropPos) {
        const need = dedicatedNeed(input.starterNeeds, dropPos);
        const startableThis = countStartableAtPos(
          roster,
          metaById,
          dropPos,
          week,
          new Set([id]),
        );
        const startableNext = countStartableAtPos(
          roster,
          metaById,
          dropPos,
          nextWeek,
          new Set([id]),
        );
        const surplusThis = startableThis - need;
        const surplusNext = startableNext - need;
        if (surplusThis > 0) score += Math.min(60, surplusThis * 20);
        if (surplusNext > 0) score += Math.min(40, surplusNext * 12);
        // Protect last useful copy at a dedicated position for next week.
        if (need > 0 && startableNext < need) score -= 250;
        if (dropPos === "QB" && startableThis < need) score -= 400;
      }

      // Streamer-ish extras (extra K/DEF) are cheaper to cut than skill depth.
      if (dropPos === "K" || dropPos === "DEF") score += 40;

      // Least effective last: lower weekly value → higher drop score.
      score -= rankValue(meta);
      if (!nextOk) score -= 350;

      candidates.push({
        id,
        score,
        nextOk,
        reason: isUnstartableThisWeek(meta, week)
          ? reasonForUnstartable(meta, week)
          : "missing",
      });
    }

    candidates.sort(
      (a, b) =>
        Number(b.nextOk) - Number(a.nextOk) ||
        b.score - a.score ||
        a.id.localeCompare(b.id),
    );
    const best = candidates[0];
    if (!best) return { id: null, reason: "missing" };
    return { id: best.id, reason: best.reason };
  };

  while (plans.length < AI_STREAMER_MAX_PLANS) {
    if (canFillStartingLineup(working, metaById, input.starterNeeds, week)) {
      break;
    }
    const preferred = nextHolePreferredPositions(
      working,
      metaById,
      input.starterNeeds,
      week,
    );
    if (!preferred?.length) break;

    const add = pickAdd(preferred);
    if (!add) break;

    // Same roster-limit rule as humans: full active roster → drop required.
    const hasCapacityInputs =
      Number.isFinite(input.activeRosterCount) && Number.isFinite(input.rosterCapacity);
    const dropRequired = hasCapacityInputs
      ? workingActive >= capacity
      : Boolean(input.requiresDrop);
    const drop = pickDrop(working, add.id, add.pos, dropRequired);
    if (dropRequired && !drop.id) break;

    // Reason = why we needed the add (hole's unstartable / missing), not only drop.
    const holePos = preferred[0]!;
    const ownedAtHole = working.filter(
      (id) => normalizePos(metaById[id]?.pos) === holePos,
    );
    const firstUnstartable = ownedAtHole.find((id) =>
      isUnstartableThisWeek(metaById[id], week),
    );
    const reason: "bye" | "out" | "missing" =
      ownedAtHole.length === 0
        ? "missing"
        : firstUnstartable
          ? reasonForUnstartable(metaById[firstUnstartable], week)
          : drop.id
            ? drop.reason
            : "missing";

    plans.push({
      pos: add.pos,
      addPlayerId: add.id,
      dropPlayerId: drop.id,
      reason,
    });
    reservedAdds.add(add.id);
    if (drop.id) {
      reservedDrops.add(drop.id);
      working = working.filter((id) => id !== drop.id);
      // Swap keeps active count flat.
    } else {
      workingActive += 1;
    }
    working = [...working, add.id];
  }

  return plans;
}
