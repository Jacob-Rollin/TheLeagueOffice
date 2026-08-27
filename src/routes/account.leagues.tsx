import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { AccountShell } from "@/components/account/AccountShell";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/account/leagues")({
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

const inputClass =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring";
const labelClass = "block text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const buttonClass =
  "rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-60";

type Platform = "sleeper" | "espn" | "yahoo";

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

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Platform>("sleeper");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [sleeperId, setSleeperId] = useState("");
  const [espnLeague, setEspnLeague] = useState("");
  const [espnS2, setEspnS2] = useState("");
  const [espnSwid, setEspnSwid] = useState("");
  const [yahooKey, setYahooKey] = useState("");

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

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    setBusy(true);
    setStatus(null);
    const label =
      tab === "sleeper" ? sleeperId.trim() : tab === "espn" ? espnLeague.trim() : yahooKey.trim();

    if (!label) {
      setBusy(false);
      setStatus("Enter a league identifier first.");
      return;
    }

    const { error } = await supabase.from("league_connections").insert({
      user_id: userId,
      platform: tab,
      label,
      sleeper_user_id: tab === "sleeper" ? label : null,
      espn_league_id: tab === "espn" ? label : null,
      espn_s2: tab === "espn" ? espnS2.trim() || null : null,
      espn_swid: tab === "espn" ? espnSwid.trim() || null : null,
      yahoo_league_key: tab === "yahoo" ? label : null,
    });
    setBusy(false);
    setStatus(error ? error.message : "League connection saved.");
    if (!error) {
      setSleeperId("");
      setEspnLeague("");
      setEspnS2("");
      setEspnSwid("");
      setYahooKey("");
      queryClient.invalidateQueries({ queryKey: ["league-connections", userId] });
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this synced league? This cannot be undone.")) return;
    const { error } = await supabase.from("league_connections").delete().eq("id", id);
    if (error) setStatus(error.message);
    queryClient.invalidateQueries({ queryKey: ["league-connections", userId] });
  };

  const tabClass = (value: string, current: string) =>
    cn(
      "rounded-md border px-3 py-1.5 font-display text-xs uppercase tracking-wide transition-colors",
      value === current ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted-foreground",
    );

  const rows = connections ?? [];

  return (
    <AccountShell
      title="My Leagues"
      active="leagues"
      action={
        <button type="button" onClick={() => setOpen((v) => !v)} className={buttonClass}>
          {open ? "Close" : "Sync New League"}
        </button>
      }
    >
      {open && (
        <div className="mb-6 rounded-xl border border-border bg-card p-6">
          <div className="flex flex-wrap gap-2">
            {(["sleeper", "espn", "yahoo"] as const).map((value) => (
              <button key={value} type="button" className={tabClass(value, tab)} onClick={() => setTab(value)}>
                {PLATFORM_LABEL[value]}
              </button>
            ))}
          </div>

          <form onSubmit={save} className="mt-4 max-w-md space-y-3">
            {tab === "sleeper" && (
              <label className={labelClass}>
                Sleeper User Or League ID
                <input value={sleeperId} onChange={(e) => setSleeperId(e.target.value)} className={inputClass} />
              </label>
            )}

            {tab === "espn" && (
              <>
                <label className={labelClass}>
                  ESPN League ID
                  <input value={espnLeague} onChange={(e) => setEspnLeague(e.target.value)} className={inputClass} />
                </label>
                <label className={labelClass}>
                  ESPN_S2
                  <input value={espnS2} onChange={(e) => setEspnS2(e.target.value)} className={inputClass} />
                </label>
                <label className={labelClass}>
                  SWID
                  <input value={espnSwid} onChange={(e) => setEspnSwid(e.target.value)} className={inputClass} />
                </label>
              </>
            )}

            {tab === "yahoo" && (
              <>
                <label className={labelClass}>
                  Yahoo League Key
                  <input value={yahooKey} onChange={(e) => setYahooKey(e.target.value)} className={inputClass} />
                </label>
                <p className="text-xs text-muted-foreground">
                  Yahoo requires an OAuth redirect. Save the league key now and authorize when prompted.
                </p>
              </>
            )}

            <button type="submit" disabled={busy} className={buttonClass}>
              {busy ? "Saving…" : "Save Connection"}
            </button>
            {status && <p className="text-sm text-muted-foreground">{status}</p>}
          </form>
        </div>
      )}

      <ul className="space-y-3">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-4"
          >
            <span
              aria-label="Synced"
              className="flex size-6 shrink-0 items-center justify-center rounded-full border border-emerald-500 text-xs font-bold text-emerald-600"
            >
              ✓
            </span>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-background font-display text-xs uppercase text-muted-foreground">
              {(PLATFORM_LABEL[row.platform] ?? row.platform).slice(0, 2)}
            </span>

            <div className="min-w-[10rem] flex-1">
              <p className="text-sm font-semibold text-foreground">{row.label ?? "The League"}</p>
              <p className="text-xs text-muted-foreground">{PLATFORM_LABEL[row.platform] ?? row.platform}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span className="rounded-md border border-border px-2 py-1">Half PPR</span>
              <span className="rounded-md border border-border px-2 py-1">Redraft</span>
              <span className="rounded-md border border-border px-2 py-1">10 Team</span>
            </div>

            <div className="ml-auto flex items-center gap-2">
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
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem asChild className="font-medium">
                    <Link to="/account/leagues/$connectionId" params={{ connectionId: row.id }}>
                      League Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="font-medium" onSelect={() => remove(row.id)}>
                    Delete League
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
            No leagues synced yet.
          </li>
        )}
      </ul>
    </AccountShell>
  );
}
