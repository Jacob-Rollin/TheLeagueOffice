import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { loadLeagueSync, loadStandings } from "@/lib/league.server";

export default defineTool({
  name: "get_league",
  title: "Get league settings, standings and rosters",
  description:
    "Public Sleeper league detail: scoring settings, roster slots, team names, standings and every rostered player.",
  inputSchema: {
    league_id: z.string().trim().min(1).max(32).describe("Sleeper league id."),
    include: z
      .enum(["standings", "rosters", "both"])
      .default("both")
      .describe("Which sections to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ league_id, include }) => {
    const [standings, sync] = await Promise.all([
      include === "rosters" ? Promise.resolve(null) : loadStandings(league_id),
      include === "standings" ? Promise.resolve(null) : loadLeagueSync(league_id),
    ]);
    if (!standings && !sync) throw new ToolError(`No public league found with id ${league_id}.`);
    const payload = { standings, league: sync };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload as unknown as Record<string, unknown>,
    };
  },
});
