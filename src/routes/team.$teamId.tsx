import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useMemo } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { useActiveStandings } from "@/hooks/useActiveStandings";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Player } from "@/lib/draft";
import { BASE_STARTERS, optimizeLineup, scaleValue } from "@/lib/trade-engine";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/team/$teamId")({
  head: () => ({
    meta: [
      { title: "Team Roster — The League Office" },
      {
        name: "description",
        content: "Full starters, bench depth, roster market value and trade fit targets for any league rival.",
      },
      { property: "og:title", content: "Team Roster — The League Office" },
      { property: "og:description", content: "Rival roster breakdown, market value and trade fit targets." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TeamRosterPage,
});

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const weeklyOf = (p: Player) => Math.max(0, (p.proj?.half ?? 0) / 17);

const SLOT_ORDER = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"] as const;
const FLEX_OK = ["RB", "WR", "TE"];

/** Fill a starting lineup by projection, dedicated slots first then FLEX. */
function buildLineup(players: Player[]) {
  const pool = [...players].sort((a, b) => weeklyOf(b) - weeklyOf(a));
  const used = new Set<string>();
  const starters: { slot: string; player: Player | null }[] = [];
  for (const slot of SLOT_ORDER) {
    const match = pool.find(
      (p) => !used.has(p.id) && (slot === "FLEX" ? FLEX_OK.includes(p.pos) : p.pos === slot),
    );
    if (match) used.add(match.id);
    starters.push({ slot, player: match ?? null });
  }
  const bench = pool.filter((p) => !used.has(p.id));
  return { starters, bench };
}

function TeamRosterPage() {
  const { teamId } = Route.useParams();
  const { activeLeague, standings } = useActiveStandings();
  const { data } = useSleeperPlayers();
  const players = useMemo(() => data?.players ?? [], [data]);
  const { teams, myTeam, loading, refreshing } = useLeagueRosters(players);
  const brain = usePlayerBrain();

  const byName = useMemo(() => {
    const map = new Map<string, { value: number; trend: number }>();
    for (const entry of Object.values(brain ?? {})) {
      const key = normalize(entry.name ?? "");
      if (key && !map.has(key)) map.set(key, { value: entry.value ?? 0, trend: entry.trend ?? 0 });
    }
    return map;
  }, [brain]);

  const marketValue = (p: Player) => byName.get(normalize(p.name))?.value ?? 0;

  const team = useMemo(() => {
    if (!teams.length) return null;
    const bySlot = teams.find((t) => String(t.slot) === teamId);
    if (bySlot) return bySlot;
    const row = standings?.rows?.find((r) => String(r.rosterId) === teamId);
    if (row) return teams.find((t) => normalize(t.team) === normalize(row.team)) ?? null;
    return null;
  }, [teams, teamId, standings]);

  const record = useMemo(() => {
    const row = standings?.rows?.find(
      (r) => String(r.rosterId) === teamId || (team && normalize(r.team) === normalize(team.team)),
    );
    return row ? `${row.wins}-${row.losses}` : null;
  }, [standings, teamId, team]);

  const lineup = useMemo(() => buildLineup(team?.players ?? []), [team]);

  const totalValue = useMemo(
    () => (team?.players ?? []).reduce((sum, p) => sum + scaleValue(marketValue(p)), 0),
    [team, byName],
  );

  /** Rival assets that upgrade my own weakest starting slots (trade-engine driven). */
  const fitTargets = useMemo(() => {
    if (!team || !myTeam || team.isMine) return [];
    const mine = optimizeLineup(
      myTeam.players.map((p) => ({ pos: p.pos, weekly: weeklyOf(p) })),
      BASE_STARTERS,
    );
    const weakest = Object.entries(mine.bySlot)
      .filter(([slot]) => slot !== "FLEX")
      .sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0))
      .slice(0, 3)
      .map(([slot]) => slot);
    return team.players
      .filter((p) => weakest.includes(p.pos))
      .sort((a, b) => marketValue(b) - marketValue(a))
      .slice(0, 5);
  }, [team, myTeam, byName]);

  if (!activeLeague) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-16 md:px-8">
        <h1 className="display-title text-2xl">No league connected</h1>
        <p className="mt-2 text-sm text-muted-foreground">Sync a league to browse rival rosters.</p>
        <Link to="/account/leagues" className="mt-6 inline-flex rounded-lg border border-border px-4 py-2 text-sm">
          Manage My Leagues
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 md:px-8">
      <Link to="/" className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> League HQ
      </Link>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{activeLeague.name}</p>
          <h1 className="display-title text-3xl">{team?.team ?? "Team Roster"}</h1>
          <p className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">
            {team?.owner || "Owner unavailable"}
            {record ? ` • ${record}` : ""}
            {team?.isMine ? " • My Team" : ""}
          </p>
        </div>
      </div>

      {loading && !team && <p className="mt-10 text-sm text-muted-foreground">Loading roster…</p>}
      {!loading && !team && <p className="mt-10 text-sm text-muted-foreground">Roster unavailable for this team.</p>}

      {team && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <RosterCard title="Active Starters" rows={lineup.starters} value={marketValue} />
            <RosterCard
              title="Bench Depth"
              rows={lineup.bench.map((p) => ({ slot: "BN", player: p }))}
              value={marketValue}
            />
          </div>

          <aside className="space-y-4">
            <section className="rounded-xl border border-border bg-card p-4">
              <p className="eyebrow">Total Roster Market Value</p>
              <p className="mt-1 text-4xl font-black tabnum">{totalValue.toFixed(1)}</p>
              <p className="mt-1 text-[11px] uppercase tracking-widest text-muted-foreground">
                {team.players.length} assets on the book
              </p>
            </section>

            <section className="rounded-xl border border-border bg-card p-4">
              <p className="eyebrow">Top Trade Fit Targets</p>
              {fitTargets.length ? (
                <ul className="mt-2 space-y-2">
                  {fitTargets.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{p.name}</div>
                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          {p.pos} • {p.team || "FA"}
                        </div>
                      </div>
                      <span className="tabnum shrink-0 text-sm font-bold">{scaleValue(marketValue(p)).toFixed(1)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  {team.isMine
                    ? "This is your roster — open a rival team to surface trade fits."
                    : "No clear fits against your current starting lineup."}
                </p>
              )}
              <Link
                to="/trade"
                className="mt-3 flex w-full items-center justify-center rounded-lg border border-border bg-muted/40 py-2 text-xs font-bold uppercase tracking-wider transition-all hover:bg-muted/70"
              >
                Open Trade Desk
              </Link>
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}

function RosterCard({
  title,
  rows,
  value,
}: {
  title: string;
  rows: { slot: string; player: Player | null }[];
  value: (p: Player) => number;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="display-title text-xl">{title}</h2>
      <ul className="mt-3 space-y-2">
        {rows.length === 0 && <li className="text-xs text-muted-foreground">No players.</li>}
        {rows.map((r, i) => (
          <li
            key={`${r.slot}-${r.player?.id ?? i}`}
            className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2"
          >
            <span className="w-10 shrink-0 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {r.slot}
            </span>
            {r.player ? (
              <>
                <PlayerAvatar
                  id={r.player.id}
                  pos={r.player.pos}
                  team={r.player.team}
                  name={r.player.name}
                  className="size-9"
                />
                <div className="min-w-0 flex-1">
                  <Link
                    to="/player/$id"
                    params={{ id: r.player.id }}
                    className="block truncate text-sm font-semibold hover:text-primary"
                  >
                    {r.player.name}
                  </Link>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {r.player.pos} • {r.player.team || "FA"}
                    {r.player.bye ? ` • BYE ${r.player.bye}` : ""}
                  </div>
                </div>
                <span className={cn("tabnum shrink-0 text-sm font-bold")}>{scaleValue(value(r.player)).toFixed(1)}</span>
              </>
            ) : (
              <span className="text-xs italic text-muted-foreground">Empty slot</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
