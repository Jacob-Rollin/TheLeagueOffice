import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { AccountShell } from "@/components/account/AccountShell";
import { supabase } from "@/integrations/supabase/client";

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
  metadata: Record<string, unknown> | null;
  created_at: string;
};


const POINT_SETTINGS: [string, string][] = [
  ["Passing Yard", "0.04"],
  ["Passing TD", "4.0"],
  ["Interception", "-2.0"],
  ["Rushing Yard", "0.1"],
  ["Rushing TD", "6.0"],
  ["Reception", "0.5"],
  ["Receiving Yard", "0.1"],
  ["Receiving TD", "6.0"],
  ["Fumble Lost", "-2.0"],
];

const ROSTER_SLOTS: [string, string][] = [
  ["QB", "1"],
  ["RB", "2"],
  ["WR", "2"],
  ["TE", "1"],
  ["FLEX", "1"],
  ["Bench", "5"],
  ["IR", "1"],
];

function LeagueSettingsPage() {
  const { connectionId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: row, isLoading } = useQuery({
    queryKey: ["league-connection", connectionId],
    retry: false,
    queryFn: async (): Promise<Row | null> => {
      const { data, error } = await supabase
        .from("synced_leagues")
        .select("id, platform, league_id, metadata, created_at")
        .eq("id", connectionId)
        .maybeSingle();
      if (error) throw error;
      return (data as Row | null) ?? null;
    },
  });

  const removeLink = async () => {
    if (!window.confirm("Remove this synced league link? This cannot be undone.")) return;
    await supabase.from("synced_leagues").delete().eq("id", connectionId);
    queryClient.invalidateQueries({ queryKey: ["league-connections"] });
    // Flush the global navbar/context cache so the deleted league's avatar resets instantly.
    queryClient.invalidateQueries({ queryKey: ["active-league-connections"] });
    navigate({ to: "/account/leagues" });
  };


  return (
    <AccountShell title="League Settings" active="leagues">
      <div className="space-y-6">
        <section className="rounded-xl border border-border bg-card p-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading league…</p>
          ) : row ? (
            <>
              <p className="font-display text-[11px] uppercase tracking-widest text-muted-foreground">
                {row.platform}
              </p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {((row?.metadata as Record<string, unknown> | null)?.["label"] as string | undefined) ??
                  row?.league_id ??
                  "—"}
              </p>

            </>
          ) : (
            <p className="text-sm text-muted-foreground">This synced league no longer exists.</p>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="display-title text-lg uppercase tracking-wide">Point Settings</h2>
          <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {POINT_SETTINGS.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between border-b border-border py-1 text-sm">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-mono tabular-nums text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="display-title text-lg uppercase tracking-wide">Roster Requirements</h2>
          <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {ROSTER_SLOTS.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between border-b border-border py-1 text-sm">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-mono tabular-nums text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-xl border border-destructive/40 bg-card p-6">
          <h2 className="display-title text-lg uppercase tracking-wide">Remove Link</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Deletes this platform league mapping from your account. No other data is affected.
          </p>
          <button
            type="button"
            onClick={removeLink}
            className="mt-4 rounded-md bg-destructive px-4 py-2 font-display text-sm uppercase tracking-wide text-destructive-foreground"
          >
            Delete League
          </button>
        </section>
      </div>
    </AccountShell>
  );
}
