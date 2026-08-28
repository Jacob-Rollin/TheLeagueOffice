import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { AccountShell } from "@/components/account/AccountShell";
import { LeagueAvatar } from "@/components/league/LeagueAvatar";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { getConnectionMeta } from "@/lib/league.functions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/account/leagues/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "My Leagues — The League Office" },
      {
        name: "description",
        content: "Manage the Sleeper, ESPN and Yahoo leagues synced to your League Office account.",
      },
      { property: "og:title", content: "My Leagues — The League Office" },
      { property: "og:description", content: "Your synced fantasy platform leagues." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LeaguesPage,
});

const buttonClass =
  "rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-60";

export type ConnectionRow = {
  id: string;
  platform: string;
  league_id: string | null;
  espn_s2: string | null;
  swid: string | null;
  metadata: Record<string, unknown> | null;
};

const PLATFORM_LABEL: Record<string, string> = {
  sleeper: "Sleeper",
  espn: "ESPN",
  yahoo: "Yahoo",
};

function LeaguesPage() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<string | null>(null);

  const { data: connections } = useQuery({
    queryKey: ["league-connections", userId],
    enabled: Boolean(userId),
    retry: false,
    queryFn: async (): Promise<ConnectionRow[]> => {
      const { data, error } = await supabase
        .from("synced_leagues")
        .select("id, platform, league_id, espn_s2, swid, metadata")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ConnectionRow[];
    },
  });

  const remove = async (id: string) => {
    if (!id) return;
    if (!window.confirm("Delete this synced league? This cannot be undone.")) return;
    const { error } = await supabase.from("synced_leagues").delete().eq("id", id);
    if (error) setStatus(error.message);
    // Flush all league list caches — including the global navbar/context cache —
    // so the deleted league (and its avatar) disappears everywhere instantly.
    queryClient.invalidateQueries({ queryKey: ["league-connections", userId] });
    queryClient.invalidateQueries({ queryKey: ["active-league-connections", userId] });
  };

  const rows = (connections ?? []).filter((row): row is ConnectionRow => Boolean(row?.id));


  return (
    <AccountShell
      title="My Leagues"
      active="leagues"
      action={
        <Link to="/leaguesync" className={buttonClass}>
          Sync New League
        </Link>
      }
    >
      {status && <p className="mb-4 text-sm text-muted-foreground">{status}</p>}

      {rows.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl border border-border bg-card px-4 py-16">
          <p className="font-display text-sm font-semibold uppercase tracking-widest text-black">
            No Active Leagues
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <LeagueRow key={row?.id} row={row} onDelete={remove} />
          ))}
        </ul>
      )}
    </AccountShell>
  );
}

function LeagueRow({
  row,
  onDelete,
}: {
  row: ConnectionRow;
  onDelete: (id: string) => void;
}) {
  const label = (row?.metadata as Record<string, unknown> | null)?.["label"] as string | undefined;
  const identifier = row?.league_id ?? label ?? "";
  const platformKey = row?.platform ?? "sleeper";
  const platform = PLATFORM_LABEL[platformKey] ?? platformKey;

  const { data: meta } = useQuery({
    queryKey: ["connection-meta", row?.id, platformKey, identifier],
    enabled: (platformKey === "sleeper" || platformKey === "espn") && identifier.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: () =>
      getConnectionMeta({
        data: {
          identifier,
          platform: platformKey,
          ...(row?.espn_s2 ? { s2: row.espn_s2 } : {}),
          ...(row?.swid ? { swid: row.swid } : {}),
        },
      }),
  });

  const avatar = meta?.avatar ?? null;
  const leagueName = meta?.leagueName ?? label ?? "League";

  const teamName = meta?.teamName ?? null;
  const subtitle = teamName ? `${teamName} - ${platform}` : platform;

  return (
    <li className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-4">
      <span
        aria-label="Synced"
        className="flex size-6 shrink-0 items-center justify-center rounded-full border border-emerald-500 text-xs font-bold text-emerald-600"
      >
        ✓
      </span>

      <LeagueAvatar platform={platformKey} src={avatar} alt={`${leagueName} team avatar`} />


      <div className="min-w-[10rem] flex-1">
        <p className="text-base font-semibold leading-tight text-black">{leagueName}</p>
        <p className="text-sm font-medium leading-tight text-black">{subtitle}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="rounded-md border border-border px-2 py-1">{meta?.scoring ?? "Scoring"}</span>
        <span className="rounded-md border border-border px-2 py-1">Redraft</span>
        <span className="rounded-md border border-border px-2 py-1">{meta?.teams ? `${meta.teams} Team` : "Teams"}</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Link
          to="/account/leagues/$connectionId"
          params={{ connectionId: row?.id }}
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
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem asChild className="font-medium">
              <Link to="/account/leagues/$connectionId" params={{ connectionId: row?.id }}>
                League Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem className="font-medium" onSelect={() => onDelete(row?.id)}>
              Delete League
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
