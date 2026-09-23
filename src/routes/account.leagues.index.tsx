import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { AccountShell } from "@/components/account/AccountShell";
import { LeagueAvatar } from "@/components/league/LeagueAvatar";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { getConnectionMeta, getConnectionRosters } from "@/lib/league.functions";
import { markRevalidated, writeRosterCache } from "@/lib/roster-cache";
import { touchLeagueSyncTimestamp } from "@/lib/league-sync-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/account/leagues/")({
  ssr: false,
  head: () => ({ meta: [{ title: "My Leagues — The League Office" }, { name: "robots", content: "noindex" }] }),
  component: LeaguesPage,
});

const buttonClass = "rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-60";

export type ConnectionRow = {
  id: string;
  platform: string;
  league_id: string | null;
  espn_s2: string | null;
  swid: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string;
};

const PLATFORM_LABEL: Record<string, string> = { sleeper: "Sleeper", espn: "ESPN", yahoo: "Yahoo" };

function formatRelativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "recently";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(timestamp).toLocaleDateString();
}

function LeaguesPage() {
  const { user } = useAuth();
  const { setActiveLeagueId } = useActiveLeague();
  const navigate = useNavigate();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [, setClock] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const { data: connections } = useQuery({
    queryKey: ["league-connections", userId],
    enabled: Boolean(userId),
    retry: false,
    queryFn: async (): Promise<ConnectionRow[]> => {
      const { data, error } = await supabase
        .from("synced_leagues")
        .select("id, platform, league_id, espn_s2, swid, metadata, updated_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ConnectionRow[];
    },
  });

  const remove = async (id: string) => {
    if (!id || !window.confirm("Delete this synced league? This cannot be undone.")) return;
    await supabase.from("synced_leagues").delete().eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["league-connections", userId] });
    queryClient.invalidateQueries({ queryKey: ["active-league-connections", userId] });
  };

  const refreshRoster = async (row: ConnectionRow) => {
    const identifier = row.league_id?.trim() ?? "";
    if (!identifier || refreshingId) return;
    setRefreshingId(row.id);
    try {
      const rosterData = await getConnectionRosters({
        data: {
          identifier,
          platform: row.platform,
          ...(row.espn_s2 ? { s2: row.espn_s2 } : {}),
          ...(row.swid ? { swid: row.swid } : {}),
        },
      });
      if (!rosterData) throw new Error("The roster could not be loaded from the league provider.");
      const cacheKey = `${row.id}:all`;
      queryClient.setQueryData(["league-rosters", row.id], rosterData);
      queryClient.invalidateQueries({ queryKey: ["league-rosters", row.id] });
      markRevalidated(cacheKey);
      await writeRosterCache(cacheKey, rosterData);
      await touchLeagueSyncTimestamp(row.id, queryClient, userId);
    } catch (error) {
      console.warn("[account/leagues] roster refresh failed:", error);
    } finally {
      setRefreshingId(null);
    }
  };

  const viewPlaybook = (id: string) => {
    setActiveLeagueId(id);
    void navigate({ to: "/playbook" });
  };
  const rows = (connections ?? []).filter((row): row is ConnectionRow => Boolean(row?.id));

  return (
    <AccountShell title="My Leagues" active="leagues" action={<Link to="/leaguesync" className={buttonClass}>Sync New League</Link>}>
      {rows.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl border border-border bg-card px-4 py-16"><p className="font-display text-sm font-semibold uppercase tracking-widest text-black">No Active Leagues</p></div>
      ) : (
        <ul className="space-y-3">{rows.map((row) => <LeagueRow key={row.id} row={row} isRefreshing={refreshingId === row.id} onDelete={remove} onRefresh={refreshRoster} onViewPlaybook={viewPlaybook} />)}</ul>
      )}
    </AccountShell>
  );
}

function LeagueRow({ row, isRefreshing, onDelete, onRefresh, onViewPlaybook }: { row: ConnectionRow; isRefreshing: boolean; onDelete: (id: string) => void; onRefresh: (row: ConnectionRow) => void; onViewPlaybook: (id: string) => void }) {
  const label = (row.metadata as Record<string, unknown> | null)?.label as string | undefined;
  const identifier = row.league_id ?? label ?? "";
  const platformKey = row.platform ?? "sleeper";
  const platform = PLATFORM_LABEL[platformKey] ?? platformKey;
  const { data: meta } = useQuery({
    queryKey: ["connection-meta", row.id, platformKey, identifier],
    enabled: (platformKey === "sleeper" || platformKey === "espn") && identifier.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: () => getConnectionMeta({ data: { identifier, platform: platformKey, ...(row.espn_s2 ? { s2: row.espn_s2 } : {}), ...(row.swid ? { swid: row.swid } : {}) } }),
  });
  const leagueName = meta?.leagueName ?? label ?? "League";
  const teamName = meta?.teamName ?? null;
  const subtitle = teamName ? `${teamName} - ${platform}` : platform;

  return (
    <li className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-4">
      <span aria-label="Synced" className="flex size-6 shrink-0 items-center justify-center rounded-full border border-emerald-500 text-xs font-bold text-emerald-600">✓</span>
      <LeagueAvatar platform={platformKey} src={meta?.avatar ?? null} alt={`${leagueName} team avatar`} />
      <div className="min-w-[10rem] flex-1"><p className="text-base font-semibold leading-tight text-black">{leagueName}</p><p className="text-sm font-medium leading-tight text-black">{subtitle}</p></div>
      <div className="flex shrink-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="-ml-2 w-36 shrink-0 whitespace-nowrap text-left text-sm font-medium normal-case tracking-normal text-foreground">Synced {formatRelativeTime(row.updated_at)}</span>
        <span className="rounded-md border border-border px-2 py-1">{meta?.scoring ?? "Scoring"}</span>
        <span className="rounded-md border border-border px-2 py-1">Redraft</span>
        <span className="rounded-md border border-border px-2 py-1">{meta?.teams ? `${meta.teams} Team` : "Teams"}</span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Link to="/account/leagues/$connectionId" params={{ connectionId: row.id }} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground">Settings</Link>
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="League options" className="rounded-md border border-border px-2 py-1.5 text-xs leading-none text-foreground">⋮</DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem asChild className="font-medium"><Link to="/account/leagues/$connectionId" params={{ connectionId: row.id }}>League Settings</Link></DropdownMenuItem>
            <DropdownMenuItem className="font-medium" onSelect={() => onViewPlaybook(row.id)}>View Playbook</DropdownMenuItem>
            <DropdownMenuItem className="font-medium" disabled={isRefreshing || !row.league_id} onSelect={() => void onRefresh(row)}>{isRefreshing ? "Refreshing Roster…" : "Refresh Roster"}</DropdownMenuItem>
            <DropdownMenuItem className="font-medium" onSelect={() => onDelete(row.id)}>Delete League</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
