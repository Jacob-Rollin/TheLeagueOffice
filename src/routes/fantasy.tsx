import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { FantasyArticlesColumn } from "@/components/fantasy/FantasyArticlesColumn";
import { FantasyHubStandings } from "@/components/fantasy/FantasyHubStandings";
import { FantasyHubTransactions } from "@/components/fantasy/FantasyHubTransactions";
import { LeagueSettingsChangesPanel } from "@/components/native/fantasy";
import { FantasyJoinAnotherCard } from "@/components/fantasy/FantasyJoinAnotherCard";
import { FantasyLeaguesBox } from "@/components/fantasy/FantasyLeaguesBox";
import { NativeLeagueSubNav } from "@/components/nav/NativeLeagueSubNav";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { listNativeLeagueSummaries } from "@/lib/native-league.functions";

export const Route = createFileRoute("/fantasy")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Fantasy — The League Office" }],
  }),
  component: FantasyDashboardPage,
});

function FantasyDashboardPage() {
  const { user, ready } = useAuth();
  const { activeLeagueId, setActiveLeagueId } = useActiveLeague();

  const { data: leagues = [], isLoading } = useQuery({
    queryKey: ["native-league-summaries"],
    enabled: Boolean(ready && user?.id),
    staleTime: 60_000,
    retry: false,
    queryFn: () => listNativeLeagueSummaries(),
  });

  const selectedLinkId = useMemo(() => {
    if (!leagues.length) return null;
    if (activeLeagueId && leagues.some((l) => l.linkId === activeLeagueId)) {
      return activeLeagueId;
    }
    return leagues[0]?.linkId ?? null;
  }, [leagues, activeLeagueId]);

  // Keep ActiveLeague in sync when the hub falls back to the first native league.
  useEffect(() => {
    if (selectedLinkId && selectedLinkId !== activeLeagueId) {
      setActiveLeagueId(selectedLinkId);
    }
  }, [selectedLinkId, activeLeagueId, setActiveLeagueId]);

  return (
    <>
      {selectedLinkId ? <NativeLeagueSubNav linkId={selectedLinkId} /> : null}
      <main className="mx-auto w-full max-w-shell px-3 pb-16 pt-6">
        <div className="mb-6">
          <h1 className="display-title text-3xl text-slate-900">
            Fantasy <span className="text-primary">Home</span>
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            News for managers and a quick look at your League Office teams.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            <FantasyArticlesColumn />
          </div>

          <aside className="min-w-0 space-y-4 lg:col-span-1">
            {!ready ? (
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-slate-500">Loading…</p>
              </section>
            ) : !user ? (
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="font-display text-lg font-bold uppercase tracking-wide text-slate-900">
                  Fantasy
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Sign in to see your League Office teams here.
                </p>
                <Link
                  to="/auth"
                  className="mt-3 inline-flex items-center rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white hover:bg-blue-700"
                >
                  Sign In
                </Link>
              </section>
            ) : (
              <FantasyLeaguesBox
                leagues={leagues}
                loading={isLoading}
                selectedLinkId={selectedLinkId}
                onSelectLeague={setActiveLeagueId}
              />
            )}
            <FantasyJoinAnotherCard />
            {user && selectedLinkId ? (
              <>
                <FantasyHubStandings linkId={selectedLinkId} />
                <LeagueSettingsChangesPanel linkId={selectedLinkId} />
                <FantasyHubTransactions linkId={selectedLinkId} />
              </>
            ) : null}
          </aside>
        </div>
      </main>
    </>
  );
}
