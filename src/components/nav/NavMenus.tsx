import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AuthDialog, type AuthMode } from "@/components/auth/AuthDialog";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, Plus, User as UserIcon } from "lucide-react";

import { LeagueAvatar } from "@/components/league/LeagueAvatar";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const triggerClass =
  "flex items-center gap-1 rounded-md border-b-2 border-transparent px-3 py-1.5 font-display text-sm uppercase tracking-wide text-primary-foreground/70 transition-colors hover:text-primary-foreground data-[state=open]:border-accent data-[state=open]:text-primary-foreground";

export const navLinkClass =
  "rounded-md border-b-2 border-transparent px-3 py-1.5 font-display text-sm uppercase tracking-wide text-primary-foreground/70 transition-colors hover:text-primary-foreground data-[status=active]:border-accent data-[status=active]:text-primary-foreground";

const PLAYBOOK: { to: string; label: string }[] = [
  { to: "/war-room", label: "War Room" },
  { to: "/mock-draft/setup", label: "Mock Draft Simulator" },
  { to: "/trade-desk", label: "Trade Desk" },
  { to: "/the-wire", label: "The Wire" },
];

export function FrontOfficeMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={triggerClass}>
        Playbook
        <ChevronDown className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {PLAYBOOK.map((item) => (
          <DropdownMenuItem key={item.to} asChild>
            <Link to={item.to} className="block w-full whitespace-nowrap font-medium">
              {item.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type MemberRow = { league_id: string; team_name: string; leagues: { name: string } | null };

export function ActiveOperationsMenu() {
  const { user, ready } = useAuth();
  const userId = user?.id ?? null;
  const canQuery = Boolean(ready && userId);

  const { data: memberships } = useQuery({
    queryKey: ["league-memberships", userId],
    enabled: canQuery,
    retry: false,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      if (!userId) return [] as MemberRow[];
      const { data, error } = await supabase
        .from("league_members")
        .select("league_id, team_name, leagues(name)")
        .eq("user_id", userId);
      if (error) throw error;
      return (data ?? []) as unknown as MemberRow[];
    },
  });

  if (!canQuery) return null;

  const leagues = memberships ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={triggerClass}>
        Active Operations
        <ChevronDown className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="font-display text-[11px] uppercase tracking-widest text-muted-foreground">
          My Leagues
        </DropdownMenuLabel>
        {leagues.length > 0 ? (
          leagues.map((m) => (
            <DropdownMenuItem key={m.league_id} asChild>
              <Link to="/" className="flex items-center gap-2">
                <span className="flex-1 truncate font-medium">{m.leagues?.name ?? "League"}</span>
                <span className="truncate text-xs text-muted-foreground">{m.team_name}</span>
              </Link>
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem asChild>
            <Link to="/" className="flex items-center gap-2 font-medium">
              <Plus className="size-4" />
              Create or Join a League
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProfileMenu() {
  const { user, ready, signOut } = useAuth();
  const navigate = useNavigate();
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [open, setOpen] = useState(false);
  const { data: profile } = useProfile(user?.id ?? null);
  const { leagues, activeLeagueId, setActiveLeagueId, sandboxMode, toggleSandbox } = useActiveLeague();

  const openAuth = (mode: AuthMode) => {
    setAuthMode(mode);
    setAuthOpen(true);
  };

  // Subscribe to the global active league: the moment the last league is deleted,
  // activeLeague flushes to null and the navbar icon resets to the default silhouette.
  const activeLeague = leagues?.find((l) => l?.id === activeLeagueId) ?? null;
  const navPlatform = activeLeague?.platform ?? null;
  const navAvatar = activeLeague?.avatar ?? (navPlatform ? null : (profile?.avatar_url ?? null));

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        {ready && user && (navPlatform || navAvatar) ? (
          <DropdownMenuTrigger
            aria-label="Profile and settings"
            className={cn(
              "flex items-center justify-center w-8 h-8 max-w-8 max-h-8 rounded-full p-0 overflow-hidden border border-neutral-200 bg-white shrink-0",
            )}
          >
            <LeagueAvatar
              platform={navPlatform}
              src={navAvatar}
              alt=""
              className="size-8"
            />
          </DropdownMenuTrigger>
        ) : (
          <DropdownMenuTrigger
            aria-label="Profile and settings"
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-full border border-primary-foreground/30 bg-primary-foreground/10 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-foreground/20",
            )}
          >
            <UserIcon className="size-4" />
          </DropdownMenuTrigger>
        )}


        <DropdownMenuContent align="end" className={ready && user ? "w-[26rem] p-0" : "w-56"}>
          {ready && user ? (
            <div className="flex">
              {/* Left pane — synced leagues */}
              <div className="flex w-[60%] flex-col border-r border-border p-2">
                <p className="px-2 py-1 font-display text-[11px] font-semibold uppercase tracking-widest text-foreground">
                  Active Leagues
                </p>

                <div className="mt-1 flex-1 space-y-1">
                  {(leagues?.length ?? 0) > 0 ? (
                    (leagues ?? []).map((league) => (
                      <button
                        key={league?.id}
                        type="button"
                        onClick={() => league?.id && setActiveLeagueId(league.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left transition-colors",
                          league?.id === activeLeagueId
                            ? "border-accent bg-accent/10"
                            : "border-transparent hover:bg-muted",
                        )}
                      >
                        <LeagueAvatar
                          platform={league?.platform}
                          src={league?.avatar}
                          alt=""
                          className="size-8"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-black">
                            {league?.name ?? "League"}
                          </span>
                          <span className="block truncate text-xs text-black">
                            {league?.teamName ?? "My Team"}
                          </span>
                        </span>
                      </button>
                    ))

                  ) : (
                    <div className="flex items-center justify-center px-2 py-8">
                      <p className="font-display text-xs font-semibold uppercase tracking-widest text-black">
                        No Active Leagues
                      </p>
                    </div>
                  )}
                </div>
                <Link
                  to="/leaguesync"
                  onClick={() => setOpen(false)}
                  className="mt-2 block w-full rounded-md bg-primary px-3 py-2 text-center font-display text-xs uppercase tracking-wide text-primary-foreground"
                >
                  Sync New League
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    toggleSandbox();
                    setOpen(false);
                  }}
                  className="mt-3 block w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {sandboxMode ? "Exit Sandbox Mode" : "Enter Sandbox Mode"}
                </button>
              </div>

              {/* Right pane — account navigation */}
              <div className="flex w-[40%] flex-col p-2">
                <DropdownMenuLabel className="truncate px-2 text-xs font-normal text-muted-foreground">
                  {user.email}
                </DropdownMenuLabel>
                <DropdownMenuItem asChild className="font-medium">
                  <Link to="/account" className="block w-full">
                    Account
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="font-medium">
                  <Link to="/account/leagues" className="block w-full">
                    My Leagues
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="font-medium"
                  onSelect={async () => {
                    await signOut();
                    navigate({ to: "/" });
                  }}
                >
                  Sign Out
                </DropdownMenuItem>
              </div>
            </div>
          ) : (
            <>
              <DropdownMenuItem
                className="font-medium"
                onSelect={(e) => {
                  e.preventDefault();
                  openAuth("signin");
                }}
              >
                Sign In
              </DropdownMenuItem>
              <DropdownMenuItem
                className="font-medium"
                onSelect={(e) => {
                  e.preventDefault();
                  openAuth("signup");
                }}
              >
                Create Account
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AuthDialog open={authOpen} mode={authMode} onOpenChange={setAuthOpen} />
    </>
  );
}
