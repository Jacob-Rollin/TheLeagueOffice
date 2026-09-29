import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ComponentType, type ReactNode } from "react";
import {
  Activity,
  CalendarClock,
  CalendarDays,
  Calculator,
  ChevronRight,
  ClipboardList,
  Coins,
  Hash,
  ListOrdered,
  RefreshCw,
  Shield,
  Shuffle,
  Trophy,
  Users,
} from "lucide-react";

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
import { supabase } from "@/integrations/supabase/client";
import {
  RESERVE_SLOT_KEYS,
  ROSTER_SLOT_LABEL,
  SCORING_GROUPS,
  STARTER_SLOT_KEYS,
  formatScoringValue,
  rosterSummary,
  scoringFormatLabel,
  scoringRows,
  type LeagueSettingsDetail,
  type RosterSlotKey,
} from "@/lib/league-settings";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/account/leagues/$connectionId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "League Settings — The League Office" },
      {
        name: "description",
        content: "Review the scoring settings and roster requirements for a synced fantasy league.",
      },
      { property: "og:title", content: "League Settings — The League Office" },
      { property: "og:description", content: "Synced league scoring and roster configuration." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LeagueSettingsPage,
});

type Row = {
  id: string;
  platform: string;
  league_id: string | null;
  espn_s2: string | null;
  swid: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type TabId = "basic" | "roster" | "scoring" | "draft";

const TABS: { id: TabId; label: string }[] = [
  { id: "basic", label: "Basic" },
  { id: "roster", label: "Roster" },
  { id: "scoring", label: "Scoring" },
  { id: "draft", label: "Draft Details" },
];

const PLATFORM_LABEL: Record<string, string> = { sleeper: "Sleeper", espn: "ESPN", yahoo: "Yahoo" };

function hostLeagueUrl(platform: string, leagueId: string | null): string | null {
  const id = leagueId?.trim();
  if (!id) return null;
  if (platform === "sleeper") return `https://sleeper.com/leagues/${encodeURIComponent(id)}`;
  if (platform === "espn") return `https://fantasy.espn.com/football/league?leagueId=${encodeURIComponent(id)}`;
  if (platform === "yahoo") return `https://football.fantasysports.yahoo.com/f1/${encodeURIComponent(id)}`;
  return null;
}

function formatDate(ms: number | null, withTime = false): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

function LeagueSettingsPage() {
  const { connectionId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("basic");

  const { data: row, isLoading } = useQuery({
    queryKey: ["league-connection", connectionId],
    retry: false,
    queryFn: async (): Promise<Row | null> => {
      const { data, error } = await supabase
        .from("synced_leagues")
        .select("id, platform, league_id, espn_s2, swid, metadata, created_at")
        .eq("id", connectionId)
        .maybeSingle();
      if (error) throw error;
      return (data as Row | null) ?? null;
    },
  });

  const platform = (row?.platform ?? "sleeper").toLowerCase();
  const identifier = row?.league_id?.trim() ?? "";

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["league-settings", connectionId, platform, identifier],
    enabled: Boolean(row && identifier),
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<LeagueSettingsDetail> => {
      const { getConnectionSettings } = await import("@/lib/league.functions");
      return await getConnectionSettings({
        data: {
          identifier,
          platform,
          ...(row?.espn_s2 ? { s2: row.espn_s2 } : {}),
          ...(row?.swid ? { swid: row.swid } : {}),
        },
      });
    },
  });

  const metaLabel = (row?.metadata as Record<string, unknown> | null)?.["label"] as string | undefined;
  const leagueLabel = settings?.leagueName ?? metaLabel ?? row?.league_id ?? null;
  const hostLabel = PLATFORM_LABEL[platform] ?? platform.toUpperCase();
  const hostUrl = hostLeagueUrl(
    platform,
    settings?.hostLeagueId ?? (/^\d+$/.test(identifier) ? identifier : null),
  );

  const confirmDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      const { error: deleteError } = await supabase
        .from("synced_leagues")
        .delete()
        .eq("id", connectionId);
      if (deleteError) throw deleteError;
      queryClient.invalidateQueries({ queryKey: ["league-connections"] });
      // Flush the global navbar/context cache so the deleted league's avatar resets instantly.
      queryClient.invalidateQueries({ queryKey: ["active-league-connections"] });
      navigate({ to: "/account/leagues" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this league.");
      setBusy(false);
    }
  };

  return (
    <AccountShell title="League Settings" active="leagues">
      <div className="space-y-6">
        <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading league…</p>
          ) : row ? (
            <div className="flex min-w-0 items-center gap-4">
              <LeagueAvatar
                platform={platform}
                src={settings?.avatar ?? null}
                alt={`${settings?.teamName ?? leagueLabel ?? "League"} team avatar`}
                className="size-14 max-h-14 max-w-14 h-14 w-14"
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                    {hostLabel}
                  </span>
                  {settings?.season ? (
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {settings.season} Season
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 truncate text-lg font-semibold text-foreground">
                  {settings?.teamName ?? (settingsLoading ? "Loading team…" : "My Team")}
                </p>
                <p className="truncate text-sm text-muted-foreground">{leagueLabel ?? "—"}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">This synced league no longer exists.</p>
          )}
          {row ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setConfirmOpen(true);
              }}
              className="shrink-0 self-start rounded-md border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 sm:self-center"
            >
              Delete League
            </button>
          ) : null}
        </section>

        {row ? (
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <header className="flex flex-col gap-1 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">Settings</h2>
                <p className="text-xs text-muted-foreground">
                  Synced from {hostLabel}. Changes to these settings are made on the host site.
                </p>
              </div>
              {hostUrl ? (
                <a
                  href={hostUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-semibold text-primary hover:underline"
                >
                  Edit on {hostLabel}
                </a>
              ) : null}
            </header>

            <div className="grid sm:grid-cols-[180px_1fr]">
              <nav className="flex gap-1 overflow-x-auto border-b border-border p-2 sm:flex-col sm:border-b-0 sm:border-r">
                {TABS.map((t) => {
                  const active = t.id === tab;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTab(t.id)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-foreground/80 transition-colors hover:bg-muted",
                        active && "bg-primary/10 font-semibold text-primary hover:bg-primary/10",
                      )}
                    >
                      {t.label}
                      {active ? <ChevronRight className="hidden size-4 sm:block" aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </nav>

              <div className="min-w-0 p-5">
                {settingsLoading ? (
                  <p className="text-sm text-muted-foreground">Loading league settings…</p>
                ) : !settings || !settings.hostLeagueId ? (
                  <p className="text-sm text-muted-foreground">
                    We couldn't load settings for this league from {hostLabel}.
                  </p>
                ) : tab === "basic" ? (
                  <BasicTab settings={settings} />
                ) : tab === "roster" ? (
                  <RosterTab settings={settings} />
                ) : tab === "scoring" ? (
                  <ScoringTab settings={settings} />
                ) : (
                  <DraftTab settings={settings} />
                )}
              </div>
            </div>
          </section>
        ) : null}
      </div>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(next) => {
          if (!next && !busy) {
            setConfirmOpen(false);
            setError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this league?</AlertDialogTitle>
            <AlertDialogDescription>
              {leagueLabel
                ? `Are you sure you want to delete "${leagueLabel}"? This removes the synced league link from your account and cannot be undone.`
                : "Are you sure you want to delete this synced league? This removes the link from your account and cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600"
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              {busy ? "Deleting…" : "Delete League"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AccountShell>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-bold uppercase tracking-wide text-slate-900">{children}</h3>;
}

function InfoItem({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold text-foreground">{value}</p>
      </div>
    </div>
  );
}

function BasicTab({ settings }: { settings: LeagueSettingsDetail }) {
  const playoffs = settings.playoffTeams
    ? `${settings.playoffTeams} teams${settings.playoffStartWeek ? ` · Starts Week ${settings.playoffStartWeek}` : ""}`
    : settings.playoffStartWeek
      ? `Starts Week ${settings.playoffStartWeek}`
      : "—";
  const waiver = settings.waiverType
    ? settings.waiverBudget
      ? `${settings.waiverType} · ${settings.waiverBudget} budget`
      : settings.waiverType
    : "—";
  const deadline = settings.tradeDeadlineWeek
    ? `Week ${settings.tradeDeadlineWeek}`
    : (formatDate(settings.tradeDeadlineDate) ?? "None");
  const draftDate = formatDate(settings.draft.date, true) ?? "Not scheduled";

  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>League</SectionTitle>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <InfoItem icon={Shield} label="League Type" value={settings.leagueType ?? "—"} />
          <InfoItem icon={Users} label="Teams" value={settings.teams ?? "—"} />
          <InfoItem icon={Trophy} label="Playoffs" value={playoffs} />
          <InfoItem icon={Calculator} label="Scoring" value={scoringFormatLabel(settings.scoring)} />
          <InfoItem icon={ClipboardList} label="Roster" value={rosterSummary(settings.roster) || "—"} />
          <InfoItem icon={RefreshCw} label="Waiver Type" value={waiver} />
          <InfoItem icon={CalendarClock} label="Trade Deadline" value={deadline} />
          <InfoItem icon={Activity} label="Status" value={settings.status ?? "—"} />
        </div>
      </div>
      <div className="border-t border-border pt-6">
        <SectionTitle>Draft</SectionTitle>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <InfoItem icon={Shuffle} label="Draft Type" value={settings.draft.type ?? "—"} />
          <InfoItem icon={ListOrdered} label="No. Rounds" value={settings.draft.rounds ?? "—"} />
          <InfoItem
            icon={Hash}
            label="Draft Position"
            value={settings.draft.position ? `Pick ${settings.draft.position}` : "Not set"}
          />
          <InfoItem icon={CalendarDays} label="Draft Date" value={draftDate} />
        </div>
      </div>
    </div>
  );
}

function SlotGrid({ keys, roster }: { keys: RosterSlotKey[]; roster: LeagueSettingsDetail["roster"] }) {
  return (
    <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
      {keys.map((key) => (
        <div key={key} className="flex items-center justify-between border-b border-border py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{ROSTER_SLOT_LABEL[key].short}</p>
            <p className="truncate text-xs text-muted-foreground">{ROSTER_SLOT_LABEL[key].long}</p>
          </div>
          <span
            className={cn(
              "flex h-8 min-w-10 items-center justify-center rounded-md border px-2 font-mono text-sm tabular-nums",
              roster[key] ? "border-primary/30 bg-primary/5 text-primary" : "border-border text-muted-foreground",
            )}
          >
            {roster[key]}
          </span>
        </div>
      ))}
    </div>
  );
}

function RosterTab({ settings }: { settings: LeagueSettingsDetail }) {
  const reserves = RESERVE_SLOT_KEYS.filter((k) => k !== "TAXI" || settings.roster.TAXI > 0);
  const total = [...STARTER_SLOT_KEYS, ...reserves].reduce((sum, k) => sum + (settings.roster[k] ?? 0), 0);
  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>Starting Lineup</SectionTitle>
        <SlotGrid keys={STARTER_SLOT_KEYS} roster={settings.roster} />
      </div>
      <div>
        <SectionTitle>Reserves</SectionTitle>
        <SlotGrid keys={reserves} roster={settings.roster} />
      </div>
      <p className="text-sm text-muted-foreground">
        Total roster spots: <span className="font-semibold text-foreground">{total}</span>
      </p>
    </div>
  );
}

function ScoringTab({ settings }: { settings: LeagueSettingsDetail }) {
  const groups = SCORING_GROUPS.filter((g) => scoringRows(g.id, settings.scoring).length > 0);
  const [group, setGroup] = useState(groups[0]?.id ?? "passing");
  const rows = scoringRows(group, settings.scoring);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-muted-foreground">Scoring Format</p>
        <p className="text-sm font-semibold text-foreground">{scoringFormatLabel(settings.scoring)}</p>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-border">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setGroup(g.id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              g.id === group
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {g.label}
          </button>
        ))}
      </div>
      <dl className="grid gap-x-6 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between border-b border-border py-2.5 text-sm">
            <dt className="text-foreground/80">{r.label}</dt>
            <dd
              className={cn(
                "font-mono tabular-nums",
                r.value < 0 ? "text-red-600" : r.value > 0 ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {formatScoringValue(r.key, r.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DraftTab({ settings }: { settings: LeagueSettingsDetail }) {
  const { draft } = settings;
  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>Draft Details</SectionTitle>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <InfoItem icon={Shuffle} label="Draft Type" value={draft.type ?? "—"} />
          <InfoItem icon={Activity} label="Draft Status" value={draft.status ?? "—"} />
          <InfoItem icon={ListOrdered} label="No. Rounds" value={draft.rounds ?? "—"} />
          <InfoItem icon={CalendarDays} label="Draft Date" value={formatDate(draft.date, true) ?? "Not scheduled"} />
          <InfoItem icon={Hash} label="Your Position" value={draft.position ? `Pick ${draft.position}` : "Not set"} />
          {draft.budget ? <InfoItem icon={Coins} label="Auction Budget" value={draft.budget} /> : null}
        </div>
      </div>
      <div className="border-t border-border pt-6">
        <SectionTitle>Draft Order</SectionTitle>
        {draft.order.length ? (
          <ol className="mt-3 grid gap-x-6 sm:grid-cols-2">
            {draft.order.map((entry) => (
              <li
                key={entry.pick}
                className={cn(
                  "flex items-center gap-3 border-b border-border px-2 py-2.5 text-sm",
                  entry.isMine && "rounded-md bg-primary/5",
                )}
              >
                <span className="w-6 shrink-0 text-right font-mono tabular-nums text-muted-foreground">
                  {entry.pick}
                </span>
                <span className={cn("min-w-0 flex-1 truncate", entry.isMine ? "font-semibold text-primary" : "text-foreground")}>
                  {entry.team}
                </span>
                {entry.isMine ? (
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">You</span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">The draft order hasn't been set yet.</p>
        )}
      </div>
    </div>
  );
}
