import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { AccountShell } from "@/components/account/AccountShell";
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
  label: string | null;
  sleeper_user_id: string | null;
  espn_league_id: string | null;
  yahoo_league_key: string | null;
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
        .from("league_connections")
        .select("id, platform, label, sleeper_user_id, espn_league_id, yahoo_league_key")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ConnectionRow[];
    },
  });

  const remove = async (id: string) => {
    if (!window.confirm("Delete this synced league? This cannot be undone.")) return;
    const { error } = await supabase.from("league_connections").delete().eq("id", id);
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
  const identifier =
    row?.sleeper_user_id ?? row?.espn_league_id ?? row?.yahoo_league_key ?? row?.label ?? "";
  const platformKey = row?.platform ?? "sleeper";
  const platform = PLATFORM_LABEL[platformKey] ?? platformKey;

  const { data: meta } = useQuery({
    queryKey: ["connection-meta", row?.id, platformKey, identifier],
    enabled: (platformKey === "sleeper" || platformKey === "espn") && identifier.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: () => getConnectionMeta({ data: { identifier, platform: platformKey } }),
  });

  const [imgOk, setImgOk] = useState(true);
  const leagueName = meta?.leagueName ?? row?.label ?? "League";
  const teamName = meta?.teamName ?? null;
  const subtitle = teamName ? `${teamName} - ${platform}` : platform;
  const avatar = imgOk ? (meta?.avatar ?? null) : null;

  return (
    <li className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-4">
      <span
        aria-label="Synced"
        className="flex size-6 shrink-0 items-center justify-center rounded-full border border-emerald-500 text-xs font-bold text-emerald-600"
      >
        ✓
      </span>

      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-background">
        {avatar ? (
          <img
            src={avatar}
            alt={`${leagueName} team avatar`}
            loading="lazy"
            className="size-full object-cover"
            onError={() => setImgOk(false)}
          />
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden className="size-5 text-muted-foreground" fill="currentColor">
            <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9Zm6.92 8H16.5a12.7 12.7 0 0 0-.83-4.2A7.02 7.02 0 0 1 18.92 11ZM12 5.06c.62.98 1.32 2.83 1.47 5.94h-2.94c.15-3.11.85-4.96 1.47-5.94ZM8.33 6.8A12.7 12.7 0 0 0 7.5 11H5.08A7.02 7.02 0 0 1 8.33 6.8ZM5.08 13H7.5c.07 1.5.35 2.94.83 4.2A7.02 7.02 0 0 1 5.08 13Zm6.92 5.94c-.62-.98-1.32-2.83-1.47-5.94h2.94c-.15 3.11-.85 4.96-1.47 5.94Zm3.67-1.74c.48-1.26.76-2.7.83-4.2h2.42a7.02 7.02 0 0 1-3.25 4.2Z" />
          </svg>
        )}
      </span>

      <div className="min-w-[10rem] flex-1">
        <p className="text-base font-semibold leading-tight text-foreground">{leagueName}</p>
        <p className="text-sm font-medium leading-tight text-muted-foreground">{subtitle}</p>
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
