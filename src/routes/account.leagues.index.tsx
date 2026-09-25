import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { AccountShell } from "@/components/account/AccountShell";
import { LeagueAvatar } from "@/components/league/LeagueAvatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { getConnectionMeta, getConnectionRosters } from "@/lib/league.functions";
import { markRevalidated, writeRosterCache } from "@/lib/roster-cache";
import { touchLeagueSyncTimestamp } from "@/lib/league-sync-state";

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

function hostLeagueUrl(platform: string, leagueId: string | null): string | null {
  const id = leagueId?.trim();
  if (!id) return null;
  if (platform === "sleeper") return `https://sleeper.com/leagues/${encodeURIComponent(id)}`;
  if (platform === "espn") return `https://fantasy.espn.com/football/league?leagueId=${encodeURIComponent(id)}`;
  if (platform === "yahoo") return `https://football.fantasysports.yahoo.com/f1/${encodeURIComponent(id)}`;
  return null;
}

function LeaguesPage() {
  const { user } = useAuth();
  const { setActiveLeagueId } = useActiveLeague();
  const navigate = useNavigate();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
      const { data, error } = await supabase.from("synced_leagues").select("id, platform, league_id, espn_s2, swid, metadata, updated_at").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ConnectionRow[];
    },
  });

  const requestDelete = (id: string, label: string) => {
    setDeleteError(null);
    setPendingDelete({ id, label });
  };

  const confirmDelete = async () => {
    if (!pendingDelete?.id) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const { error } = await supabase.from("synced_leagues").delete().eq("id", pendingDelete.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["league-connections", userId] });
      queryClient.invalidateQueries({ queryKey: ["active-league-connections", userId] });
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete this league.");
    } finally {
      setDeleting(false);
    }
  };

  const refreshRoster = async (row: ConnectionRow) => {
    const identifier = row.league_id?.trim() ?? "";
    if (!identifier || refreshingId) return;
    setRefreshingId(row.id);
    try {
      const rosterData = await getConnectionRosters({ data: { identifier, platform: row.platform, ...(row.espn_s2 ? { s2: row.espn_s2 } : {}), ...(row.swid ? { swid: row.swid } : {}) } });
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
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-[auto_auto_minmax(10rem,1fr)_10rem_auto_auto]">
          {rows.map((row) => (
            <LeagueRow
              key={row.id}
              row={row}
              isRefreshing={refreshingId === row.id}
              onDelete={requestDelete}
              onRefresh={refreshRoster}
              onViewPlaybook={viewPlaybook}
            />
          ))}
        </ul>
      )}

      <AlertDialog
        open={pendingDelete != null}
        onOpenChange={(next) => {
          if (!next && !deleting) {
            setPendingDelete(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this league?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.label
                ? `Are you sure you want to delete "${pendingDelete.label}"? This removes the synced league link from your account and cannot be undone.`
                : "Are you sure you want to delete this synced league? This removes the link from your account and cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? <p className="text-sm text-red-600">{deleteError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600"
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              {deleting ? "Deleting…" : "Delete League"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AccountShell>
  );
}

function LeagueRow({
  row,
  isRefreshing,
  onDelete,
  onRefresh,
  onViewPlaybook,
}: {
  row: ConnectionRow;
  isRefreshing: boolean;
  onDelete: (id: string, label: string) => void;
  onRefresh: (row: ConnectionRow) => void;
  onViewPlaybook: (id: string) => void;
}) {
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
  // Sleeper connections store a username in league_id — deep-link with the
  // resolved numeric hostLeagueId from connection meta when available.
  const linkId =
    platformKey === "sleeper"
      ? (meta?.hostLeagueId ?? (/^\d{6,}$/.test(identifier) ? identifier : null))
      : row.league_id;
  const hostUrl = hostLeagueUrl(platformKey, linkId);

  return (
    <li className="col-span-full grid grid-cols-1 items-center gap-x-4 gap-y-3 rounded-xl border border-border bg-card px-4 py-4 md:grid-cols-subgrid">
      <span aria-label="Synced" className="flex size-6 shrink-0 items-center justify-center rounded-full border border-emerald-500 text-xs font-bold text-emerald-600">✓</span>
      <LeagueAvatar platform={platformKey} src={meta?.avatar ?? null} alt={`${leagueName} team avatar`} />
      <div className="min-w-0">
        <p className="text-base font-semibold leading-tight text-black">{leagueName}</p>
        <p className="text-sm font-medium leading-tight text-black">
          {teamName ? (
            <>
              {teamName}
              <span className="mx-1 font-normal text-black/70">-</span>
            </>
          ) : null}
          {hostUrl ? (
            <a
              href={hostUrl}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-black/40 underline-offset-2 transition-colors hover:text-primary hover:decoration-primary"
            >
              {platform}
            </a>
          ) : (
            platform
          )}
        </p>
      </div>
      <span className="whitespace-nowrap text-sm font-medium text-foreground md:justify-self-start">
        Synced {formatRelativeTime(row.updated_at)}
      </span>
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="rounded-md border border-border px-2 py-1">{meta?.scoring ?? "Scoring"}</span>
        <span className="rounded-md border border-border px-2 py-1">Redraft</span>
        <span className="rounded-md border border-border px-2 py-1">{meta?.teams ? `${meta.teams} Team` : "Teams"}</span>
      </div>
      <div className="flex items-center gap-2 md:justify-self-end">
        <Link to="/account/leagues/$connectionId" params={{ connectionId: row.id }} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground">Settings</Link>
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="League options" className="rounded-md border border-border px-2 py-1.5 text-xs leading-none text-foreground">⋮</DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem asChild className="font-medium"><Link to="/account/leagues/$connectionId" params={{ connectionId: row.id }}>League Settings</Link></DropdownMenuItem>
            <DropdownMenuItem className="font-medium" onSelect={() => onViewPlaybook(row.id)}>View Playbook</DropdownMenuItem>
            <DropdownMenuItem className="font-medium" disabled={isRefreshing || !row.league_id} onSelect={() => void onRefresh(row)}>{isRefreshing ? "Refreshing Roster…" : "Refresh Roster"}</DropdownMenuItem>
            <DropdownMenuItem
              className="font-medium"
              onSelect={() => onDelete(row.id, leagueName)}
            >
              Delete League
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
