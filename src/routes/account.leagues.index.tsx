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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { fetchLeagueRostersForConnection } from "@/lib/league-rosters-fetch";
import {
  listNativeLeagueSummaries,
  updateNativeInviteCode,
  type NativeMemberLeagueSummary,
} from "@/lib/native-league.functions";
import { canFetchMetaClient, fetchSleeperMetaClient } from "@/lib/sleeper-meta-client";
import { markRevalidated, writeRosterCache } from "@/lib/roster-cache";
import { touchLeagueSyncTimestamp } from "@/lib/league-sync-state";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

export const Route = createFileRoute("/account/leagues/")({
  ssr: false,
  head: () => ({ meta: [{ title: "My Leagues — The League Office" }, { name: "robots", content: "noindex" }] }),
  component: LeaguesPage,
});

const buttonClass =
  "rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-60";
const outlineClass =
  "rounded-md border border-border bg-white px-4 py-2 font-display text-sm uppercase tracking-wide text-slate-800 disabled:opacity-60";

function nativeScoringLabel(preset: string | null | undefined): string {
  const key = (preset ?? "half").toLowerCase();
  if (key === "ppr") return "Full PPR";
  if (key === "std" || key === "standard") return "Standard";
  return "Half PPR";
}

export type ConnectionRow = {
  id: string;
  platform: string;
  league_id: string | null;
  espn_s2: string | null;
  swid: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string;
};

const PLATFORM_LABEL: Record<string, string> = {
  sleeper: "Sleeper",
  espn: "ESPN",
  yahoo: "Yahoo",
  native: "Native",
};

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
      const { data, error } = await supabase
        .from("synced_leagues")
        .select("id, platform, league_id, espn_s2, swid, metadata, updated_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ConnectionRow[];
    },
  });

  const { data: nativeSummaries } = useQuery({
    queryKey: ["native-league-summaries", userId],
    enabled: Boolean(userId),
    staleTime: 60_000,
    retry: false,
    queryFn: (): Promise<NativeMemberLeagueSummary[]> => listNativeLeagueSummaries(),
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
      const rosterData = await fetchLeagueRostersForConnection({
        leagueId: identifier,
        platform: row.platform,
        connectionId: row.id,
        ...(row.espn_s2 ? { s2: row.espn_s2 } : {}),
        ...(row.swid ? { swid: row.swid } : {}),
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

  const viewTools = (id: string) => {
    setActiveLeagueId(id);
    void navigate({ to: "/playbook" });
  };

  const rows = (connections ?? []).filter((row): row is ConnectionRow => Boolean(row?.id));
  const nativeRows = (nativeSummaries ?? []).filter((row): row is NativeMemberLeagueSummary =>
    Boolean(row?.linkId),
  );

  return (
    <AccountShell title="My Leagues" active="leagues">
      <Toaster />
      <div className="space-y-10">
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="display-title text-2xl text-slate-900">
                Native <span className="text-primary">Leagues</span>
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Redraft leagues hosted on The League Office.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/account/leagues/setup" className={buttonClass}>
                Create
              </Link>
              <Link to="/account/leagues/join" className={outlineClass}>
                Join
              </Link>
            </div>
          </div>

          {nativeRows.length === 0 ? (
            <div className="rounded-xl border border-border bg-card px-4 py-8 text-center">
              <p className="font-display text-sm font-semibold uppercase tracking-widest text-black">
                No Native Leagues Yet
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-[auto_auto_minmax(10rem,1fr)_10rem_auto_auto]">
              {nativeRows.map((row) => (
                <NativeLeagueRow
                  key={row.linkId}
                  summary={row}
                  onViewTools={() => viewTools(row.linkId)}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="display-title text-2xl text-slate-900">
                Synced <span className="text-primary">Leagues</span>
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Sleeper, ESPN, and Yahoo leagues connected for research tools and Playbook.
              </p>
            </div>
            <Link to="/leaguesync" className={buttonClass}>
              Sync New League
            </Link>
          </div>

          {rows.length === 0 ? (
            <div className="rounded-xl border border-border bg-card px-4 py-8 text-center">
              <p className="font-display text-sm font-semibold uppercase tracking-widest text-black">
                No Synced Leagues
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-[auto_auto_minmax(10rem,1fr)_10rem_auto_auto]">
              {rows.map((row) => (
                <LeagueRow
                  key={row.id}
                  row={row}
                  isRefreshing={refreshingId === row.id}
                  onDelete={requestDelete}
                  onRefresh={refreshRoster}
                  onViewPlaybook={viewTools}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

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

function NativeLeagueRow({
  summary,
  onViewTools,
}: {
  summary: NativeMemberLeagueSummary;
  onViewTools: () => void;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteDraft, setInviteDraft] = useState("");
  const [inviteSaving, setInviteSaving] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const label = summary.name?.trim() || "Native League";
  const role =
    summary.role === "commissioner"
      ? "Commissioner"
      : summary.role === "co_commish"
        ? "Co-Commish"
        : "Member";
  const canEditInvite = summary.canEditInvite === true;
  const inviteCode = summary.inviteCode ?? "";
  const scoring = nativeScoringLabel(summary.scoringPreset);
  const teamCount = summary.teamCount;
  const updatedAt = summary.updatedAt || summary.createdAt;
  const linkId = summary.linkId;

  const openInvite = () => {
    setInviteError(null);
    setInviteDraft(inviteCode);
    setInviteOpen(true);
  };

  const copyInvite = async () => {
    const code = (canEditInvite ? inviteDraft : inviteCode).trim();
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Invite code copied.");
    } catch {
      toast.error("Could not copy invite code.");
    }
  };

  const saveInvite = async () => {
    if (!canEditInvite || inviteSaving) return;
    setInviteSaving(true);
    setInviteError(null);
    try {
      const result = await updateNativeInviteCode({
        data: { linkId, inviteCode: inviteDraft },
      });
      if (!result.ok) {
        setInviteError(result.error);
        return;
      }
      setInviteDraft(result.inviteCode);
      await queryClient.invalidateQueries({ queryKey: ["native-league-summaries", userId] });
      await queryClient.invalidateQueries({ queryKey: ["native-league-summary", linkId] });
      toast.success("Invite code updated.");
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Could not update invite code.");
    } finally {
      setInviteSaving(false);
    }
  };

  return (
    <li className="col-span-full grid grid-cols-1 items-center gap-x-4 gap-y-3 rounded-xl border border-border bg-card px-4 py-4 md:grid-cols-subgrid">
      <span
        aria-label="Native"
        className="flex size-6 shrink-0 items-center justify-center rounded-full border border-primary text-[10px] font-bold text-primary"
      >
        N
      </span>
      <LeagueAvatar platform="native" alt={label} />
      <div className="min-w-0">
        <p className="text-base font-semibold leading-tight text-black">{label}</p>
        <p className="text-sm font-medium leading-tight text-black">
          Native
          <span className="mx-1 font-normal text-black/70">-</span>
          {role}
        </p>
      </div>
      <span className="whitespace-nowrap text-sm font-medium text-foreground md:justify-self-start">
        Updated {formatRelativeTime(updatedAt)}
      </span>
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="rounded-md border border-border px-2 py-1">{scoring}</span>
        <span className="rounded-md border border-border px-2 py-1">Redraft</span>
        <span className="rounded-md border border-border px-2 py-1">
          {teamCount ? `${teamCount} Team` : "Teams"}
        </span>
      </div>
      <div className="flex items-center gap-2 md:justify-self-end">
        <Link
          to="/league/$linkId/settings"
          params={{ linkId }}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground"
        >
          Settings
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="League options"
            className="rounded-md border border-border px-2 py-1.5 text-xs leading-none text-foreground"
          >
            ⋮
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem asChild className="font-medium">
              <Link to="/league/$linkId" params={{ linkId }}>
                Open League
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="font-medium">
              <Link to="/league/$linkId/settings" params={{ linkId }}>
                League Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem className="font-medium" onSelect={() => onViewTools()}>
              View Tools
            </DropdownMenuItem>
            <DropdownMenuItem className="font-medium" onSelect={() => openInvite()}>
              Invite Code
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>League invite code</DialogTitle>
            <DialogDescription>
              {canEditInvite
                ? "Share this code so managers can join. Commissioners can customize it."
                : "Share this code with managers who still need to join."}
            </DialogDescription>
          </DialogHeader>
          {canEditInvite ? (
            <label className="block text-sm font-medium text-slate-800">
              Invite code
              <input
                className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 font-mono text-sm uppercase tracking-wider text-slate-900 outline-none focus:border-primary"
                value={inviteDraft}
                onChange={(e) =>
                  setInviteDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16))
                }
                maxLength={16}
                spellCheck={false}
              />
            </label>
          ) : (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-base tracking-wider text-foreground">
              {inviteCode || "—"}
            </p>
          )}
          {inviteError ? <p className="text-sm text-red-600">{inviteError}</p> : null}
          <DialogFooter className="gap-2 sm:justify-between">
            <button type="button" className={outlineClass} onClick={() => void copyInvite()}>
              Copy
            </button>
            <div className="flex flex-wrap gap-2">
              {canEditInvite ? (
                <button
                  type="button"
                  className={buttonClass}
                  disabled={inviteSaving || inviteDraft.trim().length < 4}
                  onClick={() => void saveInvite()}
                >
                  {inviteSaving ? "Saving…" : "Save"}
                </button>
              ) : null}
              <button type="button" className={outlineClass} onClick={() => setInviteOpen(false)}>
                Close
              </button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
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
  const label = (row.metadata as Record<string, unknown> | null)?.["label"] as string | undefined;
  const identifier = row.league_id ?? label ?? "";
  const platformKey = row.platform ?? "sleeper";
  const platform = PLATFORM_LABEL[platformKey] ?? platformKey;
  const { data: meta } = useQuery({
    queryKey: ["connection-meta", row.id, platformKey, identifier],
    enabled: (platformKey === "sleeper" || platformKey === "espn") && identifier.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      let hostId = identifier;
      if (platformKey === "sleeper") {
        const { ensureSleeperNumericLeagueId, persistResolvedSleeperLeagueId } = await import(
          "@/lib/sleeper-resolve-client"
        );
        const resolved = await ensureSleeperNumericLeagueId(hostId).catch(() => null);
        if (resolved) {
          if (resolved !== hostId) void persistResolvedSleeperLeagueId(row.id, resolved);
          hostId = resolved;
        } else {
          try {
            if (import.meta.env.PROD) return null;
          } catch {
            /* ignore */
          }
        }
      }
      if (canFetchMetaClient(platformKey, hostId)) {
        return fetchSleeperMetaClient(hostId, label);
      }
      if (platformKey === "sleeper") {
        try {
          if (import.meta.env.PROD) return null;
        } catch {
          /* ignore */
        }
      }
      const { getConnectionMeta } = await import("@/lib/league.functions");
      const {
        espnFluidCacheKey,
        espnFluidMemo,
        ESPN_FLUID_SETTINGS_TTL_MS,
      } = await import("@/lib/espn-fluid-cache");
      const fluidKey = espnFluidCacheKey("meta", hostId, platformKey);
      return espnFluidMemo(fluidKey, ESPN_FLUID_SETTINGS_TTL_MS, () =>
        getConnectionMeta({
          data: {
            identifier: hostId,
            platform: platformKey,
            ...(row.espn_s2 ? { s2: row.espn_s2 } : {}),
            ...(row.swid ? { swid: row.swid } : {}),
          },
        }),
      );
    },
  });
  const leagueName = meta?.leagueName ?? label ?? "League";
  const teamName = meta?.teamName ?? null;
  const linkId =
    platformKey === "sleeper"
      ? (meta?.hostLeagueId ?? (/^\d{6,}$/.test(identifier) ? identifier : null))
      : row.league_id;
  const hostUrl = hostLeagueUrl(platformKey, linkId);

  return (
    <li className="col-span-full grid grid-cols-1 items-center gap-x-4 gap-y-3 rounded-xl border border-border bg-card px-4 py-4 md:grid-cols-subgrid">
      <span
        aria-label="Synced"
        className="flex size-6 shrink-0 items-center justify-center rounded-full border border-emerald-500 text-xs font-bold text-emerald-600"
      >
        ✓
      </span>
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
        <span className="rounded-md border border-border px-2 py-1">
          {meta?.teams ? `${meta.teams} Team` : "Teams"}
        </span>
      </div>
      <div className="flex items-center gap-2 md:justify-self-end">
        <Link
          to="/account/leagues/$connectionId"
          params={{ connectionId: row.id }}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground"
        >
          Settings
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="League options"
            className="rounded-md border border-border px-2 py-1.5 text-xs leading-none text-foreground"
          >
            ⋮
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem asChild className="font-medium">
              <Link to="/account/leagues/$connectionId" params={{ connectionId: row.id }}>
                League Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem className="font-medium" onSelect={() => onViewPlaybook(row.id)}>
              View Playbook
            </DropdownMenuItem>
            <DropdownMenuItem
              className="font-medium"
              disabled={isRefreshing || !row.league_id}
              onSelect={() => void onRefresh(row)}
            >
              {isRefreshing ? "Refreshing Roster…" : "Refresh Roster"}
            </DropdownMenuItem>
            <DropdownMenuItem className="font-medium" onSelect={() => onDelete(row.id, leagueName)}>
              Delete League
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
