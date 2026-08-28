import { ActiveLeagueLabel } from "@/components/league/ActiveLeagueLabel";
import { SyncLock } from "@/components/league/SyncLock";
import { useAuth } from "@/hooks/useAuth";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { PlayerPicker } from "@/components/league/PlayerPicker";
import type { Player } from "@/lib/draft";
import { evaluateWaiver } from "@/lib/evaluate";
import { getPlayers } from "@/lib/players.functions";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { cn } from "@/lib/utils";

const playersQuery = queryOptions({
  queryKey: ["players"],
  queryFn: () => getPlayers(),
  staleTime: 1000 * 60 * 30,
});

export const Route = createFileRoute("/waiver")({
  head: () => ({
    meta: [
      { title: "Waiver Evaluator — DraftRoom" },
      {
        name: "description",
        content:
          "Grade waiver wire claims: compare the player you're adding to the one you're dropping and get a FAAB bid range.",
      },
      { property: "og:title", content: "Waiver Evaluator — DraftRoom" },
      {
        property: "og:description",
        content: "Waiver claim grades and FAAB bid guidance for your fantasy roster.",
      },
    ],
  }),
  loader: ({ context }) => {
    void context.queryClient.ensureQueryData(playersQuery);
  },
  component: WaiverRoute,
});

function WaiverRoute() {
  const { activeLeagueId } = useActiveLeague();
  return <WaiverPage key={activeLeagueId ?? "none"} />;
}

function WaiverPage() {
  const { data } = useSuspenseQuery(playersQuery);
  const league = useLeagueRosters(data.players);
  const { user, ready: authReady } = useAuth();
  const { activeLeague } = useActiveLeague();
  const locked = !authReady || !user || !activeLeague?.id;
  const [add, setAdd] = useState<Player[]>([]);
  const [drop, setDrop] = useState<Player[]>([]);

  /** Wire targets exclude anyone already rostered in the active synced league. */
  const freeAgents = useMemo(() => {
    if (!league?.synced) return data.players;
    return data.players.filter((p) => !league.rosteredIds.has(p.id));
  }, [data.players, league?.synced, league?.rosteredIds]);

  const myRoster = useMemo(
    () => (league?.synced ? (league?.myTeam?.players ?? []) : data.players),
    [league?.synced, league?.myTeam, data.players],
  );

  const result = useMemo(() => evaluateWaiver(add[0] ?? null, drop[0] ?? null), [add, drop]);
  const ready = add.length > 0;


  return (
    <main className="mx-auto grid w-full max-w-[100rem] gap-4 px-3 pb-16 pt-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="display-title text-3xl">Waiver Evaluator</h1>
          <ActiveLeagueLabel />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Compare a waiver add to the roster spot it costs you.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <PlayerPicker
            label="Add from waivers"
            accent="get"
            single
            players={freeAgents}
            selected={add}
            onAdd={(p) => setAdd([p])}
            onRemove={() => setAdd([])}
          />
          <PlayerPicker
            label="Drop from roster"
            single
            players={myRoster}
            selected={drop}
            onAdd={(p) => setDrop([p])}
            onRemove={() => setDrop([])}
          />
        </div>

        <section className="mt-4 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-4">
          <div
            className={cn(
              "flex h-16 w-16 items-center justify-center rounded-lg border font-display text-3xl font-bold",
              !ready
                ? "border-border text-muted-foreground"
                : result.grade.tone === "good"
                  ? "border-primary bg-primary/10 text-primary"
                  : result.grade.tone === "bad"
                    ? "border-destructive bg-destructive/10 text-destructive"
                    : "border-border bg-surface text-foreground",
            )}
          >
            {ready ? result.grade.letter : "—"}
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">{result.verdict}</p>
            {ready && (
              <p className="tabnum mt-1 text-xs text-muted-foreground">
                Add {result.addValue} · Drop {result.dropValue} · Net{" "}
                {result.gain > 0 ? "+" : ""}
                {result.gain}
              </p>
            )}
          </div>
        </div>

        {ready && (
          <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border">
            <Cell label="Suggested FAAB" value={`${result.faabLow}–${result.faabHigh}%`} />
            <Cell label="Value gain" value={`${result.gainPct > 0 ? "+" : ""}${result.gainPct.toFixed(0)}%`} />
          </div>
        )}
      </section>
    </main>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="tabnum font-display text-lg font-semibold">{value}</div>
    </div>
  );
}

/** Right column: the user's synced roster; clicking a row fills the drop slot. */
function MyRosterPanel({ players, onPick }: { players: Player[]; onPick: (p: Player) => void }) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <h2 className="font-display text-xs font-bold uppercase tracking-widest text-black">My Roster</h2>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        {players.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">No players on this roster.</p>
        ) : (
          <ul className="divide-y divide-border">
            {players.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface"
                >
                  <span className="min-w-0 truncate text-sm font-medium text-black">{p.name}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground">
                    {p.pos} · {p.team}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
