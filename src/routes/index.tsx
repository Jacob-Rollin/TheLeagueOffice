import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { getStandings, getUserLeagues } from "@/lib/league.functions";
import type { LeagueSummary, Standings } from "@/lib/league.server";
import { cn } from "@/lib/utils";

const KEY = "ff-league-link-v1";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Welcome To The League — DraftRoom" },
      {
        name: "description",
        content:
          "Link your Sleeper league to see live standings, then jump into the draft board, trade evaluator and waiver evaluator.",
      },
      { property: "og:title", content: "Welcome To The League — DraftRoom" },
      {
        property: "og:description",
        content:
          "Live Sleeper standings plus a draft board, trade evaluator and waiver evaluator in one place.",
      },
    ],
  }),
  component: Home,
});

type Saved = { username: string; leagueId: string };

function Home() {
  const [username, setUsername] = useState("");
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [standings, setStandings] = useState<Standings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const leaguesM = useMutation({
    mutationFn: (name: string) => getUserLeagues({ data: { username: name } }),
  });
  const standingsM = useMutation({
    mutationFn: (leagueId: string) => getStandings({ data: { leagueId } }),
  });

  const loadLeague = async (leagueId: string, name: string) => {
    setError(null);
    const res = await standingsM.mutateAsync(leagueId);
    if (!res) {
      setError("Couldn't load that league.");
      return;
    }
    setStandings(res);
    localStorage.setItem(KEY, JSON.stringify({ username: name, leagueId } satisfies Saved));
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Saved;
      if (saved.username) setUsername(saved.username);
      if (saved.leagueId) {
        standingsM.mutateAsync(saved.leagueId).then((res) => res && setStandings(res));
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = async () => {
    setError(null);
    setStandings(null);
    const res = await leaguesM.mutateAsync(username);
    setLeagues(res);
    if (!res.length) setError("No leagues found for that Sleeper username.");
    else if (res.length === 1) await loadLeague(res[0]!.id, username);
  };

  const unlink = () => {
    localStorage.removeItem(KEY);
    setStandings(null);
    setLeagues([]);
  };

  return (
    <main className="mx-auto w-full max-w-4xl px-3 pb-16">
      <section className="py-10 text-center">
        <h1 className="display-title text-4xl leading-tight sm:text-5xl">
          Welcome To The <span className="text-primary">League</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
          Link your Sleeper account to track live standings, then grade trades and waiver
          claims or fire up the draft board.
        </p>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-display text-sm uppercase tracking-widest text-muted-foreground">
          Your Sleeper league
        </h2>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Sleeper username"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            onClick={search}
            disabled={!username.trim() || leaguesM.isPending}
            className="rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-50"
          >
            {leaguesM.isPending ? "Looking…" : "Link league"}
          </button>
          {standings && (
            <button
              onClick={unlink}
              className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Unlink
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        {leagues.length > 1 && !standings && (
          <ul className="mt-3 space-y-1">
            {leagues.map((l) => (
              <li key={l.id}>
                <button
                  onClick={() => loadLeague(l.id, username)}
                  className="flex w-full items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-left text-sm hover:border-primary"
                >
                  <span className="truncate">{l.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {l.season} · {l.teams} teams · {l.scoring}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {standingsM.isPending && (
        <p className="mt-6 text-center text-sm text-muted-foreground">Loading standings…</p>
      )}

      {standings && (
        <section className="mt-6">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="display-title text-2xl">{standings.league.name}</h2>
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
              {standings.league.season} · {standings.league.scoring}
            </span>
          </div>
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left">#</th>
                  <th className="px-2 py-2 text-left">Team</th>
                  <th className="px-2 py-2 text-right">W-L-T</th>
                  <th className="px-2 py-2 text-right">PF</th>
                  <th className="px-2 py-2 text-right">PA</th>
                </tr>
              </thead>
              <tbody>
                {standings.rows.map((r, i) => (
                  <tr key={r.rosterId} className={cn("border-t border-border", i < 4 && "bg-primary/5")}>
                    <td className="tabnum px-2 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="px-2 py-2">
                      <div className="truncate font-medium">{r.team}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{r.owner}</div>
                    </td>
                    <td className="tabnum px-2 py-2 text-right">
                      {r.wins}-{r.losses}
                      {r.ties ? `-${r.ties}` : ""}
                    </td>
                    <td className="tabnum px-2 py-2 text-right">{r.pointsFor}</td>
                    <td className="tabnum px-2 py-2 text-right text-muted-foreground">
                      {r.pointsAgainst}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mt-8 grid gap-3 sm:grid-cols-3">
        <HomeCard to="/draft" title="Draft board" desc="Live ADP, projections, snake board." />
        <HomeCard to="/trade" title="Trade evaluator" desc="Grade any trade package instantly." />
        <HomeCard to="/waiver" title="Waiver evaluator" desc="Claim grades and FAAB guidance." />
      </section>
    </main>
  );
}

function HomeCard({ to, title, desc }: { to: string; title: string; desc: string }) {
  return (
    <Link
      to={to}
      className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary"
    >
      <div className="font-display text-lg uppercase tracking-wide">{title}</div>
      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
    </Link>
  );
}
