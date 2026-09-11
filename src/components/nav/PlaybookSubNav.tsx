import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { navLinkClass } from "@/components/nav/NavMenus";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { cn } from "@/lib/utils";

const LINKS: {
  to:
    | "/playbook"
    | "/playbook/my-team"
    | "/playbook/rankings"
    | "/playbook/matchup"
    | "/playbook/rosters"
    | "/playbook/transactions";
  label: string;
}[] = [
  { to: "/playbook", label: "Dashboard" },
  { to: "/playbook/my-team", label: "My Team" },
  { to: "/playbook/rankings", label: "Power Rankings" },
  { to: "/playbook/matchup", label: "Matchup" },
  { to: "/playbook/rosters", label: "Rosters" },
  { to: "/playbook/transactions", label: "Transactions" },
];

function platformLabel(platform: string): string {
  const value = platform.trim().toLowerCase();
  if (value === "espn") return "ESPN";
  if (value === "sleeper") return "Sleeper";
  if (value === "yahoo") return "Yahoo";
  return platform || "League";
}

function teamInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "TM";
  const letters = cleaned.replace(/[^a-zA-Z0-9]/g, "");
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

function resolveAvatarUrl(raw?: string | null): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  if (
    value === "0" ||
    lower === "default" ||
    lower === "null" ||
    lower === "undefined" ||
    lower === "none"
  ) {
    return null;
  }
  if (/sleepercdn\.com\/avatars(?:\/thumbs)?\/(?:0|default)(?:[/?#.]|$)/i.test(value)) {
    return null;
  }
  if (/\/(?:0|default)(?:\.[a-z0-9]+)?(?:[?#]|$)/i.test(value)) {
    return null;
  }
  return value;
}

function LeagueProfileAvatar({
  name,
  avatar,
  platform,
  cacheKey,
  compact = false,
}: {
  name: string;
  avatar?: string | null;
  platform?: string | null;
  cacheKey?: string | null;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = resolveAvatarUrl(avatar);
  const plat = (platform ?? "").trim().toLowerCase();
  const shell = compact
    ? "mr-2 flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200/80 bg-slate-50 text-[9px] font-bold text-slate-600"
    : "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200/80 bg-slate-50 text-xs font-bold text-slate-600";
  const remountKey = `${cacheKey ?? "league"}:${src ?? "none"}:${plat}`;

  useEffect(() => {
    setFailed(false);
  }, [src, cacheKey, plat]);

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

  if (plat === "espn") {
    return (
      <span key={remountKey} className={cn(shell, "bg-white p-0.5")}>
        <img
          src="/espn.png"
          alt="ESPN"
          className={compact ? "h-4 w-4 object-contain" : "h-6 w-6 object-contain"}
          aria-hidden="true"
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

function LeagueProfileCard({
  leagueName,
  teamName,
  platform,
  avatar,
  cacheKey,
  showPlatform = true,
  compact = false,
}: {
  leagueName: string;
  teamName: string;
  platform: string;
  avatar?: string | null;
  cacheKey?: string | null;
  showPlatform?: boolean;
  compact?: boolean;
}) {
  return (
    <span className={cn("flex min-w-0 items-center", compact ? "" : "flex-1 gap-2.5")}>
      <LeagueProfileAvatar
        name={teamName || leagueName}
        avatar={avatar ?? null}
        platform={platform}
        cacheKey={cacheKey ?? null}
        compact={compact}
      />
      <span className="min-w-0 flex-1 text-left">
        <span
          className={cn(
            "block truncate",
            compact ? "text-[11px] font-bold text-slate-800" : "text-xs font-bold text-slate-800",
          )}
        >
          {leagueName}
        </span>
        <span
          className={cn(
            "block truncate font-medium text-slate-500",
            compact ? "text-[10px]" : "text-[11px]",
          )}
        >
          {teamName}
        </span>
      </span>
      {showPlatform ? (
        <span className="shrink-0 text-[11px] font-medium text-slate-500">
          {platformLabel(platform)}
        </span>
      ) : null}
    </span>
  );
}

export function LeagueSwitcher() {
  const { leagues, activeLeague, activeLeagueId, setActiveLeagueId } = useActiveLeague();
  if (!leagues.length) return null;

  const activeLeagueName = activeLeague?.name?.trim() || "League";
  const activeTeamName = activeLeague?.teamName?.trim() || "My Team";

  return (
    <DropdownMenu key={activeLeagueId ?? "none"}>
      <DropdownMenuTrigger className="flex h-9 max-w-[190px] items-center rounded-lg border border-border/80 bg-white px-2.5 py-0.5 text-left shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {activeLeague ? (
          <>
            <LeagueProfileCard
              key={`trigger-${activeLeagueId ?? "none"}`}
              leagueName={activeLeagueName}
              teamName={activeTeamName}
              platform={activeLeague.platform}
              avatar={activeLeague.avatar}
              cacheKey={activeLeagueId ?? null}
              showPlatform={false}
              compact
            />
            <ChevronDown className="ml-1 size-3.5 shrink-0 text-slate-500" aria-hidden="true" />
          </>
        ) : (
          <span className="px-1 text-[11px] font-semibold text-slate-700">Select league</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-1">
        {leagues.map((league) => {
          const selected = league.id === activeLeagueId;
          return (
            <DropdownMenuItem
              key={league.id}
              className={cn(
                "cursor-pointer rounded-md px-2 py-2 text-slate-700 transition-colors",
                "hover:bg-slate-50 hover:text-slate-900",
                "focus:bg-slate-50 focus:text-slate-900",
                "data-[highlighted]:bg-slate-50 data-[highlighted]:text-slate-900",
                selected && "bg-slate-50",
              )}
              onSelect={() => setActiveLeagueId(league.id)}
            >
              <LeagueProfileCard
                leagueName={league.name?.trim() || "League"}
                teamName={league.teamName?.trim() || "My Team"}
                platform={league.platform}
                avatar={league.avatar}
                cacheKey={league.id}
              />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function linkIsActive(pathname: string, to: string): boolean {
  if (to === "/playbook") {
    return pathname === "/playbook" || pathname === "/playbook/";
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}

/**
 * Sub-navbar: league under brand wordmark; Dashboard under Playbook.
 * Outer frame matches requested low-profile bar; inner track mirrors SiteNav.
 */
export function PlaybookSubNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex h-12 w-full items-center justify-between border-b border-border/50 bg-slate-50/90 px-6">
      {/* Same max-w + column geometry as SiteNav (px-3) so Dashboard sits under Playbook */}
      <div className="mx-auto flex h-12 w-full max-w-6xl items-center gap-2 px-3">
        <div className="relative mr-2 shrink-0">
          <span className="display-title invisible whitespace-nowrap text-lg" aria-hidden="true">
            THE LEAGUE <span className="rounded px-1.5">OFFICE</span>
          </span>
          <div className="absolute inset-y-0 left-0 flex items-center">
            <LeagueSwitcher />
          </div>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          <span
            className={cn(navLinkClass, "pointer-events-none invisible select-none")}
            aria-hidden="true"
          >
            Front Office
          </span>
          <nav className="flex items-center space-x-6 text-xs font-semibold text-slate-500">
            {LINKS.map((item) => {
              const active = linkIsActive(pathname, item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "whitespace-nowrap transition-colors",
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
