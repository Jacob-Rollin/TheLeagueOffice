import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { FantasyArticlesColumn } from "@/components/fantasy/FantasyArticlesColumn";
import { FantasyHubStandings } from "@/components/fantasy/FantasyHubStandings";
import { FantasyJoinAnotherCard } from "@/components/fantasy/FantasyJoinAnotherCard";
import { FantasyLeaguesBox } from "@/components/fantasy/FantasyLeaguesBox";
import { LeagueOfficeChatRail } from "@/components/native/LeagueOfficeChatRail";
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

  const selected = useMemo(() => {
    if (!leagues.length) return null;
    if (activeLeagueId) {
      const hit = leagues.find((l) => l.linkId === activeLeagueId);
      if (hit) return hit;
    }
    return leagues[0] ?? null;
  }, [leagues, activeLeagueId]);

  const selectedLinkId = selected?.linkId ?? null;
  const selectedLeagueId = selected?.leagueId ?? null;

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
            News for managers and a live look at your League Office teams.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="min-w-0 space-y-6 lg:col-span-2">
            <FantasyArticlesColumn />
            {user && selectedLinkId ? <FantasyHubStandings linkId={selectedLinkId} /> : null}
          </div>

          <aside className="min-w-0 space-y-4 lg:col-span-1">
            {!ready ? (
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-slate-500">Loading…</p>
              </section>
            ) : !user ? (
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="display-title text-lg uppercase tracking-wide text-slate-900">
                  Your <span className="text-primary">Leagues</span>
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

            {user && selectedLinkId && selectedLeagueId ? (
              <LeagueOfficeChatRail
                linkId={selectedLinkId}
                nativeLeagueId={selectedLeagueId}
              />
            ) : (
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="display-title text-lg uppercase tracking-wide text-slate-900">
                  League <span className="text-primary">Chat</span>
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  {user
                    ? "Join or create a League Office team to open chat, transactions, and settings updates here."
                    : "Sign in to open your league chat rail."}
                </p>
              </section>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}
