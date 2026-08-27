import { createServerFn } from "@tanstack/react-start";

export const getUserLeagues = createServerFn({ method: "GET" })
  .inputValidator((input: { username: string }) => ({
    username: String(input.username ?? "").slice(0, 64),
  }))
  .handler(async ({ data }) => {
    const { loadUserLeagues } = await import("./league.server");
    return await loadUserLeagues(data.username);
  });

export const getStandings = createServerFn({ method: "GET" })
  .inputValidator((input: { leagueId: string }) => ({
    leagueId: String(input.leagueId ?? "").slice(0, 32),
  }))
  .handler(async ({ data }) => {
    const { loadStandings } = await import("./league.server");
    return await loadStandings(data.leagueId);
  });

export const getLeagueSync = createServerFn({ method: "GET" })
  .inputValidator((input: { leagueId: string; username?: string }) => ({
    leagueId: String(input.leagueId ?? "").slice(0, 32),
    username: String(input.username ?? "").slice(0, 64),
  }))
  .handler(async ({ data }) => {
    const { loadLeagueSync } = await import("./league.server");
    return await loadLeagueSync(data.leagueId, data.username);
  });

export const getConnectionMeta = createServerFn({ method: "GET" })
  .inputValidator((input: { identifier: string; platform?: string }) => ({
    identifier: String(input.identifier ?? "").slice(0, 64),
    platform: String(input.platform ?? "sleeper").slice(0, 16),
  }))
  .handler(async ({ data }) => {
    const { loadConnectionMeta, loadEspnConnectionMeta } = await import("./league.server");
    if (data.platform === "espn") return await loadEspnConnectionMeta(data.identifier);
    return await loadConnectionMeta(data.identifier);
  });
