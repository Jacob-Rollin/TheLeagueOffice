import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AuthDialog, type AuthMode } from "@/components/auth/AuthDialog";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, LogOut, Plus, User as UserIcon } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
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

const FREE_PLAYBOOK: { to: string; label: string }[] = [
  { to: "/war-room", label: "War Room" },
  { to: "/mock-draft/setup", label: "Mock Draft Simulator" },
  { to: "/trade-desk", label: "Trade Desk" },
  { to: "/the-wire", label: "The Wire" },
];

export function FrontOfficeMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={triggerClass}>
        Free Playbook
        <ChevronDown className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {FREE_PLAYBOOK.map((item) => (
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

  const openAuth = (mode: AuthMode) => {
    setAuthMode(mode);
    setAuthOpen(true);
  };

  const initials = (user?.email ?? "?").slice(0, 1).toUpperCase();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Profile and settings"
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full border border-primary-foreground/30 bg-primary-foreground/10 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-foreground/20",
          )}
        >
          {ready && user ? initials : <UserIcon className="size-4" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {ready && user ? (
            <>
              <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
                {user.email}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={async () => {
                  await signOut();
                  navigate({ to: "/" });
                }}
                className="flex items-center gap-2"
              >
                <LogOut className="size-4" />
                Sign Out
              </DropdownMenuItem>
            </>
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
