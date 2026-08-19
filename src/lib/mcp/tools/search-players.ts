import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { loadPlayers } from "@/lib/players.server";

const SCORING = ["std", "half", "ppr"] as const;

export default defineTool({
  name: "search_players",
  title: "Search fantasy players",
  description:
    "Search NFL fantasy players by name, position or team and return ADP, projections and last-season points.",
  inputSchema: {
    query: z.string().trim().max(64).optional().describe("Name fragment to match."),
    position: z
      .enum(["QB", "RB", "WR", "TE", "K", "DEF"])
      .optional()
      .describe("Filter to one position."),
    team: z.string().trim().max(4).optional().describe("NFL team abbreviation, e.g. KC."),
    scoring: z.enum(SCORING).default("half").describe("Scoring format for ADP and points."),
    limit: z.number().int().min(1).max(50).default(15),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ query, position, team, scoring, limit }) => {
    const { season, players } = await loadPlayers();
    const q = query?.toLowerCase();
    const t = team?.toUpperCase();

    const rows = players
      .filter(
        (p) =>
          (!q || p.name.toLowerCase().includes(q)) &&
          (!position || p.pos === position) &&
          (!t || p.team === t),
      )
      .sort((a, b) => a.adp[scoring] - b.adp[scoring])
      .slice(0, limit)
      .map((p) => ({
        id: p.id,
        name: p.name,
        pos: p.pos,
        team: p.team,
        bye: p.bye,
        injury: p.injury,
        adp: p.adp[scoring],
        rank: p.rank[scoring],
        projectedPoints: p.proj[scoring],
        lastSeasonPoints: p.prev?.[scoring] ?? null,
      }));

    return {
      content: [{ type: "text", text: JSON.stringify({ season, scoring, players: rows }, null, 2) }],
      structuredContent: { season, scoring, players: rows },
    };
  },
});
