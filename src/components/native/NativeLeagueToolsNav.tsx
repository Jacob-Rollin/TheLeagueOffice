import { Link, useRouterState } from "@tanstack/react-router";

import { fantasyOutlineBtn, fantasyPrimaryBtn } from "@/components/native/fantasy";
import { cn } from "@/lib/utils";

type ToolSeg = "" | "standings" | "waivers" | "teams" | "draft" | "transactions";

const TOOLS: {
  id: string;
  label: string;
  segment: ToolSeg;
  to:
    | "/league/$linkId"
    | "/league/$linkId/standings"
    | "/league/$linkId/waivers"
    | "/league/$linkId/teams"
    | "/league/$linkId/draft"
    | "/league/$linkId/transactions";
}[] = [
  { id: "league", label: "League", segment: "", to: "/league/$linkId" },
  { id: "standings", label: "Standings", segment: "standings", to: "/league/$linkId/standings" },
  { id: "waivers", label: "Waivers", segment: "waivers", to: "/league/$linkId/waivers" },
  { id: "teams", label: "Teams", segment: "teams", to: "/league/$linkId/teams" },
  { id: "draft", label: "Draft", segment: "draft", to: "/league/$linkId/draft" },
  {
    id: "transactions",
    label: "Transactions",
    segment: "transactions",
    to: "/league/$linkId/transactions",
  },
];

/** Routes that show the League tool strip (main league view + those tools). */
export function isNativeLeagueToolsPath(pathname: string, linkId: string): boolean {
  const base = `/league/${linkId}`;
  if (pathname === base || pathname === `${base}/`) return true;
  if (!pathname.startsWith(`${base}/`)) return false;
  const seg = pathname.slice(base.length + 1).split("/")[0] ?? "";
  return (
    seg === "standings" ||
    seg === "waivers" ||
    seg === "teams" ||
    seg === "draft" ||
    seg === "transactions"
  );
}

function activeSegment(pathname: string, linkId: string): ToolSeg {
  const base = `/league/${linkId}`;
  if (pathname === base || pathname === `${base}/`) return "";
  if (!pathname.startsWith(`${base}/`)) return "";
  const seg = pathname.slice(base.length + 1).split("/")[0] ?? "";
  if (
    seg === "standings" ||
    seg === "waivers" ||
    seg === "teams" ||
    seg === "draft" ||
    seg === "transactions"
  ) {
    return seg;
  }
  return "";
}

/**
 * Persistent League-area tool strip: League home, Standings, Waivers, Teams,
 * Draft, Transactions — stays visible while moving between those pages.
 */
export function NativeLeagueToolsNav({ linkId }: { linkId: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = activeSegment(pathname, linkId);

  return (
    <nav
      className="mb-4 flex flex-wrap gap-2"
      aria-label="League tools"
    >
      {TOOLS.map((tool) => {
        const isActive = tool.segment === active;
        return (
          <Link
            key={tool.id}
            to={tool.to}
            params={{ linkId }}
            preload="intent"
            className={cn(isActive ? fantasyPrimaryBtn : fantasyOutlineBtn)}
            aria-current={isActive ? "page" : undefined}
          >
            {tool.label}
          </Link>
        );
      })}
    </nav>
  );
}
