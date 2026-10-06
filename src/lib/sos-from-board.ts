/**
 * Rebuild a team × position SOS schedule from a compact SOS board snapshot.
 * Pure — no network. Used by request path + client hooks so neither fans out
 * 18 weeks of Sleeper stats.
 */

export type SosBoardLike = {
  ranks: Record<string, Record<string, [number, number]>>;
  schedule: [number, string, string][];
};

export type SosFromBoardMatchup = {
  week: number;
  opp: string;
  rank: number | null;
  pointsAllowed: number | null;
};

export type SosFromBoard = {
  grade: string;
  rank: number | null;
  pointsAllowedPerGame: number | null;
  opponents: SosFromBoardMatchup[];
};

function sosGrade(avgRank: number): string {
  if (avgRank <= 10) return "Very hard";
  if (avgRank <= 14) return "Hard";
  if (avgRank <= 19) return "Neutral";
  if (avgRank <= 24) return "Easy";
  return "Very easy";
}

export function sosPosKey(position: string): string {
  const p = (position || "").trim().toUpperCase();
  return p === "DST" ? "DEF" : p;
}

/** Build positional SOS for one NFL team from a board snapshot. */
export function sosFromBoard(
  board: SosBoardLike | null | undefined,
  team: string,
  pos: string,
): SosFromBoard | null {
  const upperTeam = (team || "").trim().toUpperCase();
  const upperPos = sosPosKey(pos);
  if (!board || !upperTeam || upperTeam === "FA" || !upperPos) return null;

  const byTeam = board.ranks[upperPos];
  if (!byTeam || Object.keys(byTeam).length === 0) return null;

  const opponents = board.schedule
    .filter(
      ([week, home, away]) =>
        week >= 1 && week <= 18 && (home === upperTeam || away === upperTeam) && home && away,
    )
    .sort((a, b) => a[0] - b[0])
    .map(([week, home, away]) => {
      const opp = home === upperTeam ? away : home;
      const cell = byTeam[opp];
      return {
        week,
        opp,
        rank: cell?.[0] ?? null,
        pointsAllowed:
          cell?.[1] != null && Number.isFinite(cell[1])
            ? Math.round(cell[1] * 100) / 100
            : null,
      };
    });

  if (!opponents.length) return null;

  const ranks = opponents.map((o) => o.rank).filter((r): r is number => r !== null);
  const avg = ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null;
  const schedulePa = opponents
    .map((o) => o.pointsAllowed)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const avgPa =
    schedulePa.length > 0
      ? schedulePa.reduce((a, b) => a + b, 0) / schedulePa.length
      : null;

  return {
    grade: avg === null ? "Unknown" : sosGrade(avg),
    rank: avg === null ? null : Math.round(avg),
    pointsAllowedPerGame: avgPa === null ? null : Math.round(avgPa * 100) / 100,
    opponents,
  };
}
