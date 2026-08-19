import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { loadPlayerDetail } from "@/lib/players.server";

export default defineTool({
  name: "get_player",
  title: "Get player profile",
  description:
    "Full profile for one player: ADP, projections, prior-season stat lines, depth chart, strength of schedule and injury risk.",
  inputSchema: {
    player_id: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .describe("Sleeper player id, as returned by search_players."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ player_id }) => {
    const detail = await loadPlayerDetail(player_id);
    if (!detail) throw new ToolError(`No player found with id ${player_id}.`);
    return {
      content: [{ type: "text", text: JSON.stringify(detail, null, 2) }],
      structuredContent: detail as unknown as Record<string, unknown>,
    };
  },
});
