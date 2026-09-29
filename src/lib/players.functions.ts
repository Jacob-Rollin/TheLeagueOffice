import { createServerFn } from "@tanstack/react-start";

import { loadPlayerDetail, loadPlayers } from "./players.server";

export const getPlayers = createServerFn({ method: "GET" }).handler(async () => {
  return await loadPlayers();
});

export const getPlayerDetail = createServerFn({ method: "GET" })
  .inputValidator((input: { id: string }) => ({ id: String(input.id).slice(0, 32) }))
  .handler(async ({ data }) => {
    return await loadPlayerDetail(data.id);
  });

/** In-season valuation inputs (season to date, last season, rest-of-season projections). */
export const getTradeValueBasis = createServerFn({ method: "GET" }).handler(async () => {
  const { loadTradeValueBasis } = await import("./players.server");
  return await loadTradeValueBasis();
});

/** Injury designations, official report lines and latest news for a synced roster. */
export const getRosterNews = createServerFn({ method: "POST" })
  .inputValidator((input: { ids: string[] }) => ({
    ids: Array.from(new Set((Array.isArray(input?.ids) ? input.ids : []).map((id) => String(id).slice(0, 32))))
      .filter(Boolean)
      .slice(0, 30),
  }))
  .handler(async ({ data }) => {
    const { loadRosterNews } = await import("./players.server");
    return await loadRosterNews(data.ids);
  });

export const getPickupResults = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      identifier: string;
      platform?: string;
      s2?: string;
      swid?: string;
      requests: { key: string; playerId: string; fromWeek: number; toWeek: number }[];
    }) => ({
      identifier: String(input.identifier ?? "").slice(0, 64),
      platform: String(input.platform ?? "sleeper").slice(0, 16),
      s2: input.s2 ? String(input.s2).slice(0, 512) : undefined,
      swid: input.swid ? String(input.swid).slice(0, 64) : undefined,
      requests: (Array.isArray(input.requests) ? input.requests : []).slice(0, 400).map((r) => ({
        key: String(r.key).slice(0, 120),
        playerId: String(r.playerId).slice(0, 32),
        fromWeek: Math.max(1, Math.min(18, Math.floor(Number(r.fromWeek) || 1))),
        toWeek: Math.max(1, Math.min(18, Math.floor(Number(r.toWeek) || 1))),
      })),
    }),
  )
  .handler(async ({ data }) => {
    const { loadPickupResults } = await import("./players.server");
    return await loadPickupResults(data.requests, data.identifier, data.platform, data.s2, data.swid);
  });

export const getInjuryWire = createServerFn({ method: "GET" })
  .inputValidator((input: { limit?: number } | undefined) => ({
    limit: Math.min(Math.max(Number(input?.limit) || 5, 1), 10),
  }))
  .handler(async ({ data }) => {
    const { loadInjuryWire } = await import("./players.server");
    return await loadInjuryWire(data.limit);
  });

export const getPlayerNews = createServerFn({ method: "GET" })
  .inputValidator((input: { id: string }) => ({ id: String(input.id).slice(0, 32) }))
  .handler(async ({ data }) => {
    const { loadPlayerNews } = await import("./players.server");
    return await loadPlayerNews(data.id);
  });

export const getTeamNews = createServerFn({ method: "GET" })
  .inputValidator((input: { team: string }) => ({ team: String(input.team).slice(0, 4) }))
  .handler(async ({ data }) => {
    const { loadTeamNews } = await import("./players.server");
    return await loadTeamNews(data.team);
  });

export const getLeaguePlayerNews = createServerFn({ method: "GET" })
  .inputValidator((input?: { limit?: number }) => ({
    limit: Math.max(1, Math.min(20, Number(input?.limit ?? 10) || 10)),
  }))
  .handler(async ({ data }) => {
    const { loadLeagueWidePlayerNews } = await import("./players.server");
    return await loadLeagueWidePlayerNews(data.limit);
  });

export const getPlayerBio = createServerFn({ method: "GET" })
  .inputValidator((input: { id: string }) => ({ id: String(input.id).slice(0, 32) }))
  .handler(async ({ data }) => {
    const { loadPlayerBio } = await import("./players.server");
    return await loadPlayerBio(data.id);
  });

export const getGameLogs = createServerFn({ method: "GET" })
  .inputValidator((input: { id: string; season?: string }) => ({
    id: String(input.id).slice(0, 32),
    season: input.season != null ? String(input.season).slice(0, 16) : undefined,
  }))
  .handler(async ({ data }) => {
    const { loadGameLogs } = await import("./players.server");
    return await loadGameLogs(data.id, data.season);
  });

export const getNextGame = createServerFn({ method: "GET" })
  .inputValidator((input: { team: string }) => ({ team: String(input.team).slice(0, 4) }))
  .handler(async ({ data }) => {
    const { loadNextGame } = await import("./players.server");
    return await loadNextGame(data.team);
  });

export const getFantasyPointsAllowed = createServerFn({ method: "GET" })
  .inputValidator((input?: { season?: string }) => ({
    season: input?.season != null ? String(input.season).slice(0, 16) : undefined,
  }))
  .handler(async ({ data }) => {
    const { loadFantasyPointsAllowed } = await import("./players.server");
    return await loadFantasyPointsAllowed(data.season);
  });

/** Positional strength-of-schedule for one NFL team × fantasy position. */
export const getTeamPosSos = createServerFn({ method: "GET" })
  .inputValidator((input: { team: string; pos: string; season?: string }) => ({
    team: String(input.team).slice(0, 4),
    pos: String(input.pos).slice(0, 4),
    season: input.season != null ? String(input.season).slice(0, 16) : undefined,
  }))
  .handler(async ({ data }) => {
    const { loadTeamPosSos } = await import("./players.server");
    return await loadTeamPosSos(data.team, data.pos, data.season);
  });

export const getRedZoneStats = createServerFn({ method: "POST" })
  .inputValidator(
    (input?: {
      season?: string;
      yardline?: number | string;
      weekFrom?: number | null;
      weekTo?: number | null;
    }) => {
      const yardlineRaw = input?.yardline != null ? Number(input.yardline) : 20;
      const yardline =
        yardlineRaw === 5 || yardlineRaw === 10 || yardlineRaw === 15 || yardlineRaw === 20
          ? yardlineRaw
          : 20;
      const week = (raw: unknown) => {
        const n = Math.round(Number(raw));
        return raw != null && Number.isFinite(n) && n >= 1 && n <= 22 ? n : null;
      };
      return {
        season: input?.season != null ? String(input.season).slice(0, 16) : undefined,
        yardline,
        weekFrom: week(input?.weekFrom),
        weekTo: week(input?.weekTo),
      };
    },
  )
  .handler(async ({ data }) => {
    const { loadRedZoneStats } = await import("./redzone.server");
    return await loadRedZoneStats(data.season, data.yardline, data.weekFrom, data.weekTo);
  });

export const getMostTargetedPlayers = createServerFn({ method: "POST" })
  .inputValidator((input?: { season?: string }) => ({
    season: input?.season != null ? String(input.season).slice(0, 16) : undefined,
  }))
  .handler(async ({ data }) => {
    const { loadMostTargetedPlayers } = await import("./targets.server");
    return await loadMostTargetedPlayers(data.season);
  });

