import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { loadUserLeagues } from "@/lib/league.server";

export default defineTool({
  name: "list_sleeper_leagues",
  title: "List Sleeper leagues",
  description: "List the public Sleeper fantasy football leagues for a Sleeper username.",
  inputSchema: {
    username: z.string().trim().min(1).max(64).describe("Sleeper username."),
    season: z.string().trim().max(4).optional().describe("Season year, defaults to current."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ username, season }) => {
    const leagues = await loadUserLeagues(username, season);
    return {
      content: [{ type: "text", text: JSON.stringify({ leagues }, null, 2) }],
      structuredContent: { leagues },
    };
  },
});
