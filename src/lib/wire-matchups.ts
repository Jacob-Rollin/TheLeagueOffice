import type { Player } from "@/lib/draft";
import type { BrainMatrix } from "@/lib/playerBrainHydration";
import type { ScheduleGame } from "@/lib/players-build";
import { sosStarsFromRank, weeklySosMatchupFor, type SosMatchup } from "@/lib/sos-presentation";

export type WireScheduleByTeam = Map<string, { week: number; opp: string; isAway: boolean }[]>;

export type PositionalRankFor = (
  pos: string | null | undefined,
  opp: string | null | undefined,
) => number | null;

/** Season pace keeps bye / injured players valued; unsigned NFL free agents are worth nothing. */
export const weeklyFallback = (p: Player) => {
  const team = (p.team ?? "").trim().toUpperCase();
  if (!team || team === "FA") return 0;
  return Math.max(0, (p.proj?.half ?? 0) / 17);
};

export function formatOppLabel(raw: string | null | undefined, isAway?: boolean | null): string {
  if (!raw) return "—";
  const cleaned = raw.replace(/^vs\s+|^@\s+/i, "").trim().toUpperCase();
  if (!cleaned || cleaned === "BYE") return cleaned === "BYE" ? "BYE" : "—";
  if (isAway === true) return `@${cleaned}`;
  if (isAway === false) return `vs ${cleaned}`;
  return cleaned;
}

/** NFL schedule opponents only — ranks come from positional FPA, never DEF projections. */
export function buildScheduleByTeam(games: ScheduleGame[]): WireScheduleByTeam {
  const byTeam: WireScheduleByTeam = new Map();
  for (const g of games) {
    const home = (g.home || "").toUpperCase();
    const away = (g.away || "").toUpperCase();
    if (!g.week || g.week > 18) continue;
    if (home) {
      const rows = byTeam.get(home) ?? [];
      rows.push({ week: g.week, opp: away, isAway: false });
      byTeam.set(home, rows);
    }
    if (away) {
      const rows = byTeam.get(away) ?? [];
      rows.push({ week: g.week, opp: home, isAway: true });
      byTeam.set(away, rows);
    }
  }
  return byTeam;
}

/** Canonical SOS position key (warehouse / FPA board use DEF, not DST). */
export function sosPosKey(pos: string | null | undefined): string {
  const p = (pos || "").toUpperCase();
  return p === "DST" ? "DEF" : p;
}

/**
 * One week's opp + matchup strength — same positional FPA path as Matchup / My Team.
 * Never invents ranks; never uses DEF projection ladders.
 */
export function weeklyWireMatchup(
  player: Player,
  brain: BrainMatrix | null,
  week: number | null,
  scheduleByTeam: WireScheduleByTeam | null,
  positionalRankFor: PositionalRankFor,
): { opp: string; stars: number | null } {
  if (week == null || week <= 0) return { opp: "—", stars: null };

  const brainHit: SosMatchup | null = weeklySosMatchupFor(brain, player.id, week);
  const team = (player.team || "").trim().toUpperCase();
  const schedHit =
    team && scheduleByTeam
      ? scheduleByTeam.get(team)?.find((m) => Number(m.week) === Number(week))
      : undefined;

  // DEF units: brain rows are tagged DEF — find any same-team DEF SOS week row.
  let defBrainHit: SosMatchup | null = null;
  if (!brainHit && sosPosKey(player.pos) === "DEF" && brain && team) {
    for (const [id, entry] of Object.entries(brain)) {
      if (sosPosKey(entry.position) !== "DEF") continue;
      if ((entry.team || "").trim().toUpperCase() !== team) continue;
      defBrainHit = weeklySosMatchupFor(brain, id, week);
      if (defBrainHit) break;
    }
  }

  const hit = brainHit ?? defBrainHit;
  if (hit) {
    const oppRaw = (hit.opp || "").trim();
    if (!oppRaw) {
      return {
        opp: schedHit ? formatOppLabel(schedHit.opp, schedHit.isAway) : "BYE",
        stars: null,
      };
    }
    const rank =
      hit.rank != null && Number.isFinite(Number(hit.rank))
        ? Number(hit.rank)
        : positionalRankFor(player.pos, oppRaw);
    return {
      opp: formatOppLabel(oppRaw, schedHit?.isAway ?? null),
      stars: sosStarsFromRank(rank),
    };
  }

  if (schedHit) {
    const rank = positionalRankFor(player.pos, schedHit.opp);
    return {
      opp: formatOppLabel(schedHit.opp, schedHit.isAway),
      stars: sosStarsFromRank(rank),
    };
  }

  return { opp: "—", stars: null };
}

/** Pos rank first (players without one last), then market value, then weekly projection. */
export function sortWirePool(
  pool: Player[],
  brain: BrainMatrix | null,
  weeklyOf: (p: Player) => number,
  posRankFor: (playerId: string) => number | null,
): Player[] {
  return [...pool].sort((a, b) => {
    const aRank = posRankFor(a.id);
    const bRank = posRankFor(b.id);
    const aHas = aRank != null && Number.isFinite(aRank) && aRank > 0;
    const bHas = bRank != null && Number.isFinite(bRank) && bRank > 0;
    if (aHas && bHas && aRank !== bRank) return aRank! - bRank!;
    if (aHas !== bHas) return aHas ? -1 : 1;
    const aVal = Number(brain?.[a.id]?.value ?? 0);
    const bVal = Number(brain?.[b.id]?.value ?? 0);
    if (aVal !== bVal) return bVal - aVal;
    return weeklyOf(b) - weeklyOf(a);
  });
}
