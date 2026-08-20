import { createServerFn } from "@tanstack/react-start";

export const getHallOfFame = createServerFn({ method: "GET" }).handler(async () => {
  const { loadHallOfFame } = await import("./hof.server");
  return await loadHallOfFame();
});
