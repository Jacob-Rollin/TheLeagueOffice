import { createServerFn } from "@tanstack/react-start";

import { loadPlayers } from "./players.server";

export const getPlayers = createServerFn({ method: "GET" }).handler(async () => {
  return await loadPlayers();
});
