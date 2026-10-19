/**
 * Structured Press Room facts — computed in code, narrated by LLM or templates.
 * Shared cache key is platform + host/native league id + season (not per-user connection).
 */
import {
  eff1,
  metric,
  nameToken,
  pts2,
  UNNAMED_FRANCHISE,
  type EditorialBrief,
} from "@/lib/weekly-awards";
import type { WeeklyMatchupEntry } from "@/lib/league.server";
import { playerToken, type PressRoomArticleKind } from "@/lib/press-room-templates";

export type PressRoomScoreboardRow = {
  home: string;
  away: string;
  homePts: number;
  awayPts: number;
  margin: number;
};

export type PressRoomFactPack = {
  week: number;
  season: number;
  kind: PressRoomArticleKind;
  leagueKey: string;
  apexTeam: string;
  apexPoints: number;
  stalledTeam: string;
  stalledPoints: number;
  woodshedWinner: string;
  woodshedLoser: string;
  woodshedMargin: number;
  razorWinner: string;
  razorLoser: string;
  razorMargin: number;
  geniusTeam: string;
  geniusEfficiency: number;
  waiverPlayer: string;
  waiverPlayerId: string | null;
  waiverTeam: string;
  waiverPoints: number;
  mvpName: string | null;
  mvpId: string | null;
  mvpPoints: number | null;
  mvpTeam: string | null;
  benchBustName: string | null;
  benchBustId: string | null;
  benchBustPoints: number | null;
  benchBustTeam: string | null;
  benchBustNarrative: "won_anyway" | "cost_matchup" | null;
  previewFocusTeam: string;
  previewStarName: string | null;
  previewStarId: string | null;
  previewStarPoints: number | null;
  previewPairs: {
    home: string;
    away: string;
    homeProj: number;
    awayProj: number;
  }[];
  scoreboard: PressRoomScoreboardRow[];
};

/** Shared desk key so every member of the same host/native league reads one article. */
export function pressRoomLeagueKey(input: {
  platform: string;
  leagueId: string;
  nativeLeagueId?: string | null;
  season: number | string | null | undefined;
}): string | null {
  const platform = String(input.platform ?? "")
    .trim()
    .toLowerCase();
  if (!platform || platform === "sandbox") return null;
  const rawId =
    platform === "native"
      ? String(input.nativeLeagueId || input.leagueId || "").trim()
      : String(input.leagueId || "").trim();
  if (!rawId) return null;
  const seasonNum = Number(input.season);
  const season = Number.isFinite(seasonNum) && seasonNum > 2000 ? Math.floor(seasonNum) : new Date().getUTCFullYear();
  return `${platform}:${rawId}:${season}`;
}

export function parsePressRoomLeagueKey(leagueKey: string): {
  platform: string;
  leagueId: string;
  season: number;
} | null {
  const parts = String(leagueKey ?? "")
    .trim()
    .split(":");
  if (parts.length < 3) return null;
  const season = Number(parts[parts.length - 1]);
  if (!Number.isFinite(season)) return null;
  const platform = parts[0]!.toLowerCase();
  const leagueId = parts.slice(1, -1).join(":");
  if (!platform || !leagueId) return null;
  return { platform, leagueId, season };
}

function pairMatchups(entries: WeeklyMatchupEntry[]): PressRoomScoreboardRow[] {
  const byMatchup = new Map<number, WeeklyMatchupEntry[]>();
  for (const entry of entries) {
    const mid = Number(entry.matchupId ?? entry.rosterId ?? 0);
    const list = byMatchup.get(mid) ?? [];
    list.push(entry);
    byMatchup.set(mid, list);
  }
  const rows: PressRoomScoreboardRow[] = [];
  for (const list of byMatchup.values()) {
    if (list.length < 2) continue;
    const a = list[0]!;
    const b = list[1]!;
    const homePts = Number(a.points) || 0;
    const awayPts = Number(b.points) || 0;
    rows.push({
      home: (a.teamName || a.owner || UNNAMED_FRANCHISE).trim() || UNNAMED_FRANCHISE,
      away: (b.teamName || b.owner || UNNAMED_FRANCHISE).trim() || UNNAMED_FRANCHISE,
      homePts,
      awayPts,
      margin: Math.abs(homePts - awayPts),
    });
  }
  return rows.sort((x, y) => y.margin - x.margin);
}

export function buildPressRoomFactPack(input: {
  brief: EditorialBrief;
  kind: PressRoomArticleKind;
  leagueKey: string;
  season: number;
  entries?: WeeklyMatchupEntry[];
}): PressRoomFactPack {
  const { brief, kind, leagueKey, season } = input;
  return {
    week: brief.week,
    season,
    kind,
    leagueKey,
    apexTeam: brief.apexTeam.trim() || UNNAMED_FRANCHISE,
    apexPoints: brief.apexPoints,
    stalledTeam: brief.stalledTeam.trim() || UNNAMED_FRANCHISE,
    stalledPoints: brief.stalledPoints,
    woodshedWinner: brief.woodshedWinner.trim() || "",
    woodshedLoser: brief.woodshedLoser.trim() || "",
    woodshedMargin: brief.woodshedMargin,
    razorWinner: brief.razorWinner.trim() || "",
    razorLoser: brief.razorLoser.trim() || "",
    razorMargin: brief.razorMargin,
    geniusTeam: brief.geniusTeam.trim() || "",
    geniusEfficiency: brief.geniusEfficiency,
    waiverPlayer: brief.waiverPlayer.trim() || "",
    waiverPlayerId: brief.waiverPlayerId,
    waiverTeam: brief.waiverTeam.trim() || "",
    waiverPoints: brief.waiverPoints,
    mvpName: brief.mvpPlayer?.name ?? null,
    mvpId: brief.mvpPlayer?.id ?? null,
    mvpPoints: brief.mvpPlayer?.points ?? null,
    mvpTeam: brief.mvpPlayer?.teamName ?? null,
    benchBustName: brief.benchBustPlayer?.name ?? null,
    benchBustId: brief.benchBustPlayer?.id ?? null,
    benchBustPoints: brief.benchBustPlayer?.points ?? null,
    benchBustTeam: brief.benchBustPlayer?.teamName ?? null,
    benchBustNarrative: brief.benchBustNarrative,
    previewFocusTeam: brief.previewFocusTeam.trim() || "",
    previewStarName: brief.previewStarPlayer?.name ?? null,
    previewStarId: brief.previewStarPlayer?.id ?? null,
    previewStarPoints: brief.previewStarPlayer?.points ?? null,
    previewPairs: brief.previewPairs.map((p) => ({
      home: p.home,
      away: p.away,
      homeProj: p.homeProj,
      awayProj: p.awayProj,
    })),
    scoreboard: pairMatchups(input.entries ?? []),
  };
}

/** Stable hash of facts so regenerations can detect input drift (history stays locked unless force). */
export function hashPressRoomFactPack(pack: PressRoomFactPack): string {
  const canonical = JSON.stringify(pack, Object.keys(pack).sort());
  let hash = 2166136261;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Names/metrics the model must ground — used for post-validation. */
export function requiredFactStrings(pack: PressRoomFactPack): string[] {
  const out: string[] = [];
  const push = (value: string | null | undefined) => {
    const v = String(value ?? "").trim();
    if (v && v !== UNNAMED_FRANCHISE) out.push(v);
  };
  if (pack.kind === "recap") {
    push(pack.apexTeam);
    push(pack.stalledTeam);
    push(pts2(pack.apexPoints));
    push(pts2(pack.stalledPoints));
    if (pack.razorWinner) {
      push(pack.razorWinner);
      push(pack.razorLoser);
      push(pts2(pack.razorMargin));
    }
    if (pack.geniusTeam) {
      push(pack.geniusTeam);
      push(eff1(pack.geniusEfficiency));
    }
    push(pack.mvpName);
  } else if (pack.kind === "preview") {
    const pair = pack.previewPairs[0];
    if (pair) {
      push(pair.home);
      push(pair.away);
      push(pts2(pair.homeProj));
      push(pts2(pair.awayProj));
    }
    push(pack.previewFocusTeam);
    push(pack.previewStarName);
  } else {
    push(pack.waiverPlayer);
    push(pack.waiverTeam);
    if (pack.waiverPlayer) push(pts2(pack.waiverPoints));
    push(pack.apexTeam);
    push(pack.stalledTeam);
  }
  return [...new Set(out)];
}

/** Markup hints for the prompt so the UI keeps clickable players / bold metrics. */
export function factPackMarkupHints(pack: PressRoomFactPack): Record<string, string> {
  const hints: Record<string, string> = {
    apexTeam: nameToken(pack.apexTeam),
    apexPoints: metric(`${pts2(pack.apexPoints)}pts`),
    stalledTeam: nameToken(pack.stalledTeam),
    stalledPoints: metric(`${pts2(pack.stalledPoints)}pts`),
  };
  if (pack.razorWinner) {
    hints["razorWinner"] = nameToken(pack.razorWinner);
    hints["razorLoser"] = nameToken(pack.razorLoser);
    hints["razorMargin"] = metric(`${pts2(pack.razorMargin)}pts`);
  }
  if (pack.geniusTeam) {
    hints["geniusTeam"] = nameToken(pack.geniusTeam);
    hints["geniusEfficiency"] = metric(`${eff1(pack.geniusEfficiency)}%`);
  }
  if (pack.mvpName && pack.mvpId) {
    hints["mvpPlayer"] = playerToken({
      id: pack.mvpId,
      name: pack.mvpName,
      points: pack.mvpPoints ?? 0,
      rosterId: null,
      teamName: pack.mvpTeam || pack.apexTeam,
    });
  }
  if (pack.benchBustName && pack.benchBustId) {
    hints["benchBustPlayer"] = playerToken({
      id: pack.benchBustId,
      name: pack.benchBustName,
      points: pack.benchBustPoints ?? 0,
      rosterId: null,
      teamName: pack.benchBustTeam || "",
    });
  }
  if (pack.waiverPlayer) {
    hints["waiverPlayer"] = pack.waiverPlayerId
      ? playerToken({
          id: pack.waiverPlayerId,
          name: pack.waiverPlayer,
          points: pack.waiverPoints,
          rosterId: null,
          teamName: pack.waiverTeam,
        })
      : nameToken(pack.waiverPlayer);
    hints["waiverTeam"] = nameToken(pack.waiverTeam || UNNAMED_FRANCHISE);
    hints["waiverPoints"] = metric(`${pts2(pack.waiverPoints)}pts`);
  }
  if (pack.previewStarName && pack.previewStarId) {
    hints["previewStarPlayer"] = playerToken({
      id: pack.previewStarId,
      name: pack.previewStarName,
      points: pack.previewStarPoints ?? 0,
      rosterId: null,
      teamName: pack.previewFocusTeam,
    });
  }
  return hints;
}
