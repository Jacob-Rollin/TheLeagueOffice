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
