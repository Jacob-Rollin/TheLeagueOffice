import { createFileRoute, Link } from "@tanstack/react-router";

import { AccountShell } from "@/components/account/AccountShell";
import { NativeLeagueAccountSettings } from "@/components/native/NativeLeagueAccountSettings";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/account/leagues/native/$linkId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Native League Settings — The League Office" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NativeLeagueSettingsPage,
});

const outlineClass =
  "rounded-md border border-border bg-white px-4 py-2 font-display text-sm uppercase tracking-wide text-slate-800 disabled:opacity-60";

function NativeLeagueSettingsPage() {
  const { linkId } = Route.useParams();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  if (!userId) {
    return (
      <AccountShell title="League Settings" active="leagues">
        <p className="text-sm text-muted-foreground">Sign in to view league settings.</p>
      </AccountShell>
    );
  }

  return (
    <AccountShell
      title="League Settings"
      active="leagues"
      action={
        <Link to="/account/leagues" className={outlineClass}>
          Back to My Leagues
        </Link>
      }
    >
      <NativeLeagueAccountSettings linkId={linkId} />
    </AccountShell>
  );
}
