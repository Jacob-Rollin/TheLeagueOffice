import { defineMcp } from "@lovable.dev/mcp-js";
import type { Parameters as McpParams } from "@lovable.dev/mcp-js";

import getLeagueTool from "./tools/get-league";
import getPlayerTool from "./tools/get-player";
import listLeaguesTool from "./tools/list-leagues";
import searchPlayersTool from "./tools/search-players";

export default defineMcp({
  name: "the-league-office-v1",
  title: "The League Office V1",
  version: "0.1.0",
  instructions:
    "Fantasy football tools for The League Office. Use `search_players` to find players by name, position or team with ADP and projections, `get_player` for a full profile, `list_sleeper_leagues` to find a Sleeper user's leagues, and `get_league` for a league's settings, standings and rosters. All data comes from public Sleeper endpoints.",
  tools: [searchPlayersTool, getPlayerTool, listLeaguesTool, getLeagueTool] as unknown as AnyToolDefinition[],
});
