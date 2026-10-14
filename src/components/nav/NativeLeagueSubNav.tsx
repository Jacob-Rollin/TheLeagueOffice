import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import {
  listNativeLeagueSummaries,
  type NativeMemberLeagueSummary,
} from "@/lib/native-league.functions";
import { cn } from "@/lib/utils";

type NativeSegment =
  | ""
  | "my-team"
  | "matchup"
  | "standings"
  | "players"
  | "waivers"
  | "trades"
  | "transactions"
  | "draft";

export type NativeSubNavLink = {
  segment: NativeSegment;
  label: string;
  to:
    | "/league/$linkId"
    | "/league/$linkId/my-team"
    | "/league/$linkId/matchup"
    | "/league/$linkId/standings"
    | "/league/$linkId/players"
    | "/league/$linkId/waivers"
    | "/league/$linkId/trades"
    | "/league/$linkId/transactions"
    | "/league/$linkId/draft";
};

export const NATIVE_LEAGUE_SUBNAV_LINKS: NativeSubNavLink[] = [
  { segment: "", label: "Dashboard", to: "/league/$linkId" },
  { segment: "my-team", label: "My Team", to: "/league/$linkId/my-team" },
  { segment: "matchup", label: "Matchup", to: "/league/$linkId/matchup" },
  { segment: "standings", label: "Standings", to: "/league/$linkId/standings" },
  { segment: "players", label: "Players", to: "/league/$linkId/players" },
  { segment: "waivers", label: "Waivers", to: "/league/$linkId/waivers" },
  { segment: "trades", label: "Trades", to: "/league/$linkId/trades" },
  { segment: "transactions", label: "Transactions", to: "/league/$linkId/transactions" },
  { segment: "draft", label: "Draft", to: "/league/$linkId/draft" },
];

function hrefFor(linkId: string, segment: NativeSegment): string {
  return segment ? `/league/${linkId}/${segment}` : `/league/${linkId}`;
}

function segmentFromPath(pathname: string, linkId: string): string {
  const base = `/league/${linkId}`;
  if (pathname === base || pathname === `${base}/`) return "";
  if (!pathname.startsWith(`${base}/`)) return "";
  return pathname.slice(base.length + 1).split("/")[0] ?? "";
}

function NativeLeagueSwitcher({ linkId }: { linkId: string }) {
  const { user } = useAuth();
  const { setActiveLeagueId } = useActiveLeague();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const { data: summaries = [] } = useQuery({
    queryKey: ["native-league-summaries"],
    enabled: Boolean(user?.id),
    staleTime: 60_000,
    retry: false,
    queryFn: () => listNativeLeagueSummaries(),
  });

  const active = useMemo(
    () => summaries.find((s) => s.linkId === linkId) ?? null,
    [summaries, linkId],
  );

  useEffect(() => {
    if (linkId) setActiveLeagueId(linkId);
  }, [linkId, setActiveLeagueId]);

  if (!summaries.length) return null;

  const leagueName = active?.name?.trim() || "Native League";
  const teamLabel =
    active?.role === "commissioner"
      ? "Commissioner"
      : active?.role === "co_commish"
        ? "Co-Commish"
        : "My Team";

  const switchTo = (next: NativeMemberLeagueSummary) => {
    setActiveLeagueId(next.linkId);
    const seg = segmentFromPath(pathname, linkId);
    const match = NATIVE_LEAGUE_SUBNAV_LINKS.find((l) => l.segment === seg);
    void navigate({
      to: match?.to ?? "/league/$linkId",
      params: { linkId: next.linkId },
    });
  };

  return (
    <DropdownMenu key={linkId}>
      <DropdownMenuTrigger className="flex h-9 max-w-[190px] items-center rounded-lg border border-border/80 bg-white px-2.5 py-0.5 text-left shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="mr-2 flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200/80 bg-slate-50 text-[9px] font-bold text-slate-600">
          {leagueName.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "NL"}
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[11px] font-bold text-slate-800">{leagueName}</span>
          <span className="block truncate text-[10px] font-medium text-slate-500">{teamLabel}</span>
        </span>
        <ChevronDown className="ml-1 size-3.5 shrink-0 text-slate-500" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-1">
        {summaries.map((league) => {
          const selected = league.linkId === linkId;
          return (
            <DropdownMenuItem
              key={league.linkId}
              className={cn(
                "cursor-pointer rounded-md px-2 py-2 text-slate-700 transition-colors",
                "hover:bg-slate-50 hover:text-slate-900",
                "focus:bg-slate-50 focus:text-slate-900",
                "data-[highlighted]:bg-slate-50 data-[highlighted]:text-slate-900",
                selected && "bg-slate-50",
              )}
              onSelect={() => switchTo(league)}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200/80 bg-slate-50 text-xs font-bold text-slate-600">
                  {league.name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "NL"}
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-xs font-bold text-slate-800">
                    {league.name}
                  </span>
                  <span className="block truncate text-[11px] font-medium text-slate-500">
                    {league.filledTeams}/{league.teamCount} teams · {league.draftStatus}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] font-medium text-slate-500">Native</span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Playbook-style sub-navbar for desktop native leagues only.
 * League switcher lists native memberships; links stay on /league/$linkId/*.
 */
export function NativeLeagueSubNav({ linkId }: { linkId: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex h-12 w-full items-center justify-between border-b border-border/50 bg-slate-50/90 px-6">
      <div className="mx-auto flex h-12 w-full max-w-shell items-center gap-2 px-3">
        <div className="mr-4 grid shrink-0 items-center">
          <span
            className="display-title invisible col-start-1 row-start-1 whitespace-nowrap text-lg"
            aria-hidden="true"
          >
            THE LEAGUE <span className="rounded px-1.5">OFFICE</span>
          </span>
          <div className="col-start-1 row-start-1 flex items-center">
            <NativeLeagueSwitcher linkId={linkId} />
          </div>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          <nav className="flex items-center space-x-5 text-xs font-semibold text-slate-500">
            {NATIVE_LEAGUE_SUBNAV_LINKS.map((item) => {
              const href = hrefFor(linkId, item.segment);
              const active = item.segment
                ? pathname === href || pathname.startsWith(`${href}/`)
                : pathname === href || pathname === `${href}/`;
              return (
                <Link
                  key={item.segment || "dashboard"}
                  to={item.to}
                  params={{ linkId }}
                  preload="intent"
                  className={cn(
                    "inline-flex items-center whitespace-nowrap transition-colors",
                    active ? "border-b-2 border-blue-600 text-blue-600" : "hover:text-slate-900",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </div>
  );
}
