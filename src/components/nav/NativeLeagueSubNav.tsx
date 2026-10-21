import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  ChevronDown,
  LayoutDashboard,
  Trophy,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState, type ComponentType } from "react";

import { FootballIcon, HelmetIcon } from "@/components/mobile/league/mobileNavIcons";
import { resolveAvatarUrl } from "@/components/playbook/panels";
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

type NativeSegment = "" | "my-team" | "matchup" | "players" | "trades" | "fantasy";

export type NativeSubNavLink = {
  id: string;
  segment: NativeSegment;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Absolute hub path (Dashboard → /fantasy). */
  href?: string;
  to?:
    | "/league/$linkId"
    | "/league/$linkId/my-team"
    | "/league/$linkId/matchup"
    | "/league/$linkId/players"
    | "/league/$linkId/trades";
};

/** Primary Fantasy IA — Sleeper-style strip; Broadcast pill chrome. */
export const NATIVE_LEAGUE_SUBNAV_LINKS: NativeSubNavLink[] = [
  { id: "dashboard", segment: "fantasy", label: "Dashboard", icon: LayoutDashboard, href: "/fantasy" },
  /** League / Matchup / Team icons match mobile bottom tabs (Trophy, football, helmet). */
  { id: "league", segment: "", label: "League", icon: Trophy, to: "/league/$linkId" },
  { id: "matchup", segment: "matchup", label: "Matchup", icon: FootballIcon, to: "/league/$linkId/matchup" },
  { id: "team", segment: "my-team", label: "Team", icon: HelmetIcon, to: "/league/$linkId/my-team" },
  { id: "players", segment: "players", label: "Players", icon: Users, to: "/league/$linkId/players" },
  {
    id: "trades",
    segment: "trades",
    label: "Trades",
    icon: ArrowLeftRight,
    to: "/league/$linkId/trades",
  },
];

function hrefFor(linkId: string, segment: NativeSegment): string {
  if (segment === "fantasy") return "/fantasy";
  return segment ? `/league/${linkId}/${segment}` : `/league/${linkId}`;
}

function segmentFromPath(pathname: string, linkId: string): NativeSegment {
  if (pathname === "/fantasy" || pathname.startsWith("/fantasy/")) return "fantasy";
  const base = `/league/${linkId}`;
  if (pathname === base || pathname === `${base}/`) return "";
  if (!pathname.startsWith(`${base}/`)) return "fantasy";
  const seg = pathname.slice(base.length + 1).split("/")[0] ?? "";
  if (seg === "my-team" || seg === "matchup" || seg === "players" || seg === "trades") {
    return seg;
  }
  // Secondary tools (standings, waivers, …) highlight League.
  return "";
}

function teamInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "TM";
  const letters = cleaned.replace(/[^a-zA-Z0-9]/g, "");
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

function roleLabel(role?: string | null): string {
  if (role === "commissioner") return "Commissioner";
  if (role === "co_commish") return "Co-Commish";
  return "My Team";
}

/** Team logo (pool key → data-URI) for the fantasy sub-nav league switcher. */
function NativeSwitcherAvatar({
  teamName,
  avatarUrl,
  cacheKey,
  compact = false,
}: {
  teamName?: string | null;
  avatarUrl?: string | null;
  cacheKey: string;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const name = teamName?.trim() || "My Team";
  const src = resolveAvatarUrl(avatarUrl, { teamName: name });
  const shell = compact
    ? "mr-2 flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200/80 bg-slate-50 text-[9px] font-bold text-slate-600"
    : "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200/80 bg-slate-50 text-xs font-bold text-slate-600";
  const remountKey = `${cacheKey}:${src ?? "none"}:${name}`;

  useEffect(() => {
    setFailed(false);
  }, [src, cacheKey, name]);

  if (src && !failed) {
    return (
      <span key={remountKey} className={shell}>
        <img
          key={remountKey}
          src={src}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  return (
    <span key={remountKey} className={shell}>
      {teamInitials(name)}
    </span>
  );
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
  const teamName = active?.teamName?.trim() || null;
  const teamLabel = teamName || roleLabel(active?.role);

  const switchTo = (next: NativeMemberLeagueSummary) => {
    setActiveLeagueId(next.linkId);
    const seg = segmentFromPath(pathname, linkId);
    if (seg === "fantasy") {
      void navigate({ to: "/fantasy" });
      return;
    }
    const match = NATIVE_LEAGUE_SUBNAV_LINKS.find((l) => l.segment === seg && l.to);
    void navigate({
      to: match?.to ?? "/league/$linkId",
      params: { linkId: next.linkId },
    });
  };

  return (
    <DropdownMenu key={linkId}>
      <DropdownMenuTrigger className="flex h-9 max-w-[190px] items-center rounded-full border border-border/80 bg-white px-2.5 py-0.5 text-left shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <NativeSwitcherAvatar
          teamName={teamName}
          avatarUrl={active?.avatarUrl ?? null}
          cacheKey={`native-switcher-${linkId}`}
          compact
        />
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[11px] font-bold text-slate-800">{leagueName}</span>
          <span className="block truncate text-[10px] font-medium text-slate-500">{teamLabel}</span>
        </span>
        <ChevronDown className="ml-1 size-3.5 shrink-0 text-slate-500" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-1">
        {summaries.map((league) => {
          const selected = league.linkId === linkId;
          const rowTeam = league.teamName?.trim() || null;
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
                <NativeSwitcherAvatar
                  teamName={rowTeam}
                  avatarUrl={league.avatarUrl}
                  cacheKey={`native-switcher-row-${league.linkId}`}
                />
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-xs font-bold text-slate-800">
                    {league.name}
                  </span>
                  <span className="block truncate text-[11px] font-medium text-slate-500">
                    {rowTeam
                      ? rowTeam
                      : `${league.filledTeams}/${league.teamCount} teams · ${league.draftStatus}`}
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
 * Fantasy league sub-navbar: Dashboard (/fantasy), League, Matchup, Team,
 * Players, Trades — pill active state (Broadcast blue), Sleeper-like flow.
 */
export function NativeLeagueSubNav({ linkId }: { linkId: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeSegment = segmentFromPath(pathname, linkId);

  return (
    <div className="flex h-14 w-full items-center justify-between border-b border-border/50 bg-slate-50/90 px-6">
      <div className="mx-auto flex h-14 w-full max-w-shell items-center gap-3 px-3">
        <div className="mr-2 grid shrink-0 items-center">
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

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5">
          <nav className="flex items-center gap-1.5" aria-label="Fantasy league">
            {NATIVE_LEAGUE_SUBNAV_LINKS.map((item) => {
              const active = item.segment === activeSegment;
              const Icon = item.icon;
              const className = cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs font-bold uppercase tracking-wide transition-colors",
                active
                  ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700",
              );

              if (item.href) {
                return (
                  <Link
                    key={item.id}
                    to={item.href}
                    preload="intent"
                    className={className}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                    {item.label}
                  </Link>
                );
              }

              return (
                <Link
                  key={item.id}
                  to={item.to!}
                  params={{ linkId }}
                  preload="intent"
                  className={className}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden="true" />
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

/** @deprecated Prefer hrefFor via segment — kept for any external callers. */
export function nativeLeagueHref(linkId: string, segment: NativeSegment): string {
  return hrefFor(linkId, segment);
}
