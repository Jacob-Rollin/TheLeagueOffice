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
  .inputValidator((input?: { season?: string; yardline?: number | string }) => {
    const yardlineRaw = input?.yardline != null ? Number(input.yardline) : 20;
    const yardline =
      yardlineRaw === 5 || yardlineRaw === 10 || yardlineRaw === 15 || yardlineRaw === 20
        ? yardlineRaw
        : 20;
    return {
      season: input?.season != null ? String(input.season).slice(0, 16) : undefined,
      yardline,
    };
  })
  .handler(async ({ data }) => {
    const { loadRedZoneStats } = await import("./redzone.server");
    return await loadRedZoneStats(data.season, data.yardline);
  });

export const getMostTargetedPlayers = createServerFn({ method: "POST" })
  .inputValidator((input?: { season?: string }) => ({
    season: input?.season != null ? String(input.season).slice(0, 16) : undefined,
  }))
  .handler(async ({ data }) => {
    const { loadMostTargetedPlayers } = await import("./targets.server");
    return await loadMostTargetedPlayers(data.season);
  });

