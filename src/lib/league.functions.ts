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
