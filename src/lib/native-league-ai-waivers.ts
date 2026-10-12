/**
 * Client-safe AI waiver / FA planning for native leagues.
 * Stream K and DEF when the roster would otherwise start a bye / Out / empty slot.
 */

import {
  isUnstartableThisWeek,
  type AiLineupPlayerMeta,
} from "@/lib/native-league-ai-lineup";

export type AiStreamerPos = "K" | "DEF";

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

/**
 * Plan K/DEF streamer adds so AI teams do not start bye / Out / empty
 * kickers or defenses. One claim per position per team.
 */
export function planAiStreamerClaims(input: {
  week: number;
  rosterPlayerIds: string[];
  metaById: Record<string, AiLineupPlayerMeta>;
  /** Free-agent candidates (any pos; filtered inside). */
  freeAgents: Array<{ id: string; meta: AiLineupPlayerMeta }>;
  needK: number;
  needDef: number;
  /** True when active roster is full (add requires a drop). */
  requiresDrop: boolean;
}): AiStreamerClaimPlan[] {
  const week = Math.max(1, Math.min(18, Math.floor(input.week) || 1));
  const plans: AiStreamerClaimPlan[] = [];
  const reservedAdds = new Set<string>();
  const reservedDrops = new Set<string>();

  const ownedByPos = (pos: AiStreamerPos) =>
    input.rosterPlayerIds.filter((id) => normalizePos(input.metaById[id]?.pos) === pos);

  const pickAdd = (pos: AiStreamerPos): string | null => {
    const ranked = input.freeAgents
      .filter((fa) => {
        if (reservedAdds.has(fa.id)) return false;
        if (normalizePos(fa.meta.pos) !== pos) return false;
        return !isUnstartableThisWeek(fa.meta, week);
      })
      .sort(
        (a, b) =>
          rankValue(b.meta) - rankValue(a.meta) || a.id.localeCompare(b.id),
      );
    return ranked[0]?.id ?? null;
  };

  const pickDrop = (
    pos: AiStreamerPos,
    owned: string[],
  ): { id: string | null; reason: "bye" | "out" | "missing" } => {
    if (!input.requiresDrop) return { id: null, reason: "missing" };

    const unstartable = owned
      .filter(
        (id) =>
          !reservedDrops.has(id) && isUnstartableThisWeek(input.metaById[id], week),
      )
      .sort((a, b) => rankValue(input.metaById[a]) - rankValue(input.metaById[b]));
    if (unstartable[0]) {
      return {
        id: unstartable[0],
        reason: reasonForUnstartable(input.metaById[unstartable[0]], week),
      };
    }

    // Missing the position entirely — drop the worst non-essential (lowest value)
    // player that is not a scarce startable skill piece we just filled for.
    const disposable = input.rosterPlayerIds
      .filter((id) => {
        if (reservedDrops.has(id)) return false;
        const p = normalizePos(input.metaById[id]?.pos);
        // Prefer dropping bye/out of any pos, then deep bench K/DEF of the other slot,
        // then lowest-ranked skill players (never drop the only startable QB).
        return true;
      })
      .sort((a, b) => {
        const aMeta = input.metaById[a];
        const bMeta = input.metaById[b];
        const aBad = isUnstartableThisWeek(aMeta, week) ? 0 : 1;
        const bBad = isUnstartableThisWeek(bMeta, week) ? 0 : 1;
        if (aBad !== bBad) return aBad - bBad;
        const aPos = normalizePos(aMeta?.pos);
        const bPos = normalizePos(bMeta?.pos);
        const aStreamer = aPos === "K" || aPos === "DEF" ? 0 : 1;
        const bStreamer = bPos === "K" || bPos === "DEF" ? 0 : 1;
        if (aStreamer !== bStreamer) return aStreamer - bStreamer;
        return rankValue(aMeta) - rankValue(bMeta);
      });

    // Never drop the only startable QB.
    for (const id of disposable) {
      const p = normalizePos(input.metaById[id]?.pos);
      if (p === "QB") {
        const otherQbs = input.rosterPlayerIds.filter(
          (x) =>
            x !== id &&
            normalizePos(input.metaById[x]?.pos) === "QB" &&
            !isUnstartableThisWeek(input.metaById[x], week),
        );
        if (otherQbs.length === 0) continue;
      }
      // Don't drop a startable copy of the position we're trying to fill
      // when it's our last startable one (shouldn't happen — owned unstartable empty).
      if (p === pos) {
        const startableOthers = owned.filter(
          (x) =>
            x !== id &&
            !reservedDrops.has(x) &&
            !isUnstartableThisWeek(input.metaById[x], week),
        );
        if (startableOthers.length === 0 && !isUnstartableThisWeek(input.metaById[id], week)) {
          continue;
        }
      }
      return {
        id,
        reason: isUnstartableThisWeek(input.metaById[id], week)
          ? reasonForUnstartable(input.metaById[id], week)
          : "missing",
      };
    }
    return { id: null, reason: "missing" };
  };

  const fillPos = (pos: AiStreamerPos, need: number) => {
    if (need <= 0) return;
    const owned = ownedByPos(pos);
    const startable = owned.filter(
      (id) => !isUnstartableThisWeek(input.metaById[id], week),
    );
    let deficit = Math.max(0, need - startable.length);
    while (deficit > 0) {
      const addPlayerId = pickAdd(pos);
      if (!addPlayerId) break;
      const drop = pickDrop(pos, owned);
      if (input.requiresDrop && !drop.id) break;
      const firstUnstartable = owned.find((id) =>
        isUnstartableThisWeek(input.metaById[id], week),
      );
      const reason: "bye" | "out" | "missing" =
        owned.length === 0
          ? "missing"
          : firstUnstartable
            ? reasonForUnstartable(input.metaById[firstUnstartable], week)
            : "missing";
      plans.push({
        pos,
        addPlayerId,
        dropPlayerId: drop.id,
        reason: drop.id ? drop.reason : reason,
      });
      reservedAdds.add(addPlayerId);
      if (drop.id) reservedDrops.add(drop.id);
      deficit -= 1;
    }
  };

  fillPos("K", Math.max(0, Math.floor(input.needK) || 0));
  fillPos("DEF", Math.max(0, Math.floor(input.needDef) || 0));
  return plans;
}
