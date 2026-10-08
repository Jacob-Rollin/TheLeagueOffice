import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useRef, useState, startTransition } from "react";

import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import { PLAYER_LIST_HEADER_ROW } from "@/components/research/SortHeader";
import { useAuth } from "@/hooks/useAuth";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { getNativeLeagueBoard } from "@/lib/native-league.functions";
import { loadPlayersCatalog } from "@/lib/players-catalog";
import type { Player } from "@/lib/players-build";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/league/$linkId/players")({
  ssr: false,
  component: NativeLeaguePlayersPage,
});

const POS_FILTERS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"] as const;
type PoolFilter = "available" | "rostered" | "mine" | "all";

function NativeLeaguePlayersPage() {
  const { linkId } = Route.useParams();
  const { user } = useAuth();
  const modalRef = useRef<PlayerModalHandle>(null);
  const cache = useSleeperPlayers();
  const fallback = useQuery({
    queryKey: ["players-catalog"],
    queryFn: () => loadPlayersCatalog(),
    enabled: Boolean(cache.error) && !cache.data,
    staleTime: 1000 * 60 * 30,
  });
  const players = cache.data?.players ?? fallback.data?.players ?? [];

  const { data: board, isLoading } = useQuery({
    queryKey: ["native-league-board", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 60_000,
    queryFn: () => getNativeLeagueBoard({ data: { linkId } }),
  });

  const [pool, setPool] = useState<PoolFilter>("available");
  const [pos, setPos] = useState<(typeof POS_FILTERS)[number]>("ALL");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const myTeamId = board?.summary.teamId ?? null;
  const ownership = board?.ownership ?? {};
  const teamNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const t of board?.teams ?? []) map.set(t.id, t.teamName);
    return map;
  }, [board?.teams]);

  const rows = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const draftDone = board?.summary.draftStatus === "complete";
    return players
      .filter((p) => {
        const owner = ownership[p.id];
        if (pool === "available") return owner == null;
        if (pool === "rostered") return owner != null;
        if (pool === "mine") return myTeamId != null && owner === myTeamId;
        return true;
      })
      .filter((p) => (pos === "ALL" ? true : p.pos === pos || (pos === "DEF" && p.pos === "DEF")))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
      .slice(0, draftDone || pool !== "available" ? 200 : 120)
      .map((p) => ({
        player: p,
        ownerTeamId: ownership[p.id] ?? null,
      }));
  }, [players, ownership, pool, pos, deferredQuery, myTeamId, board?.summary.draftStatus]);

  if (isLoading || !board) {
    return <p className="text-sm text-muted-foreground">Loading players…</p>;
  }

  const draftDone = board.summary.draftStatus === "complete";
  const ownedCount = Object.keys(ownership).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display-title text-2xl text-slate-900">
            League <span className="text-primary">Players</span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ownership from your league (TiDB). Names and NFL context from the shared player catalog.
            {!draftDone
              ? " Draft is not complete — available list mirrors undrafted players."
              : ` ${ownedCount} rostered.`}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["available", "Available"],
            ["rostered", "Rostered"],
            ["mine", "My Team"],
            ["all", "All"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => startTransition(() => setPool(key))}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide",
              pool === key
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-blue-700",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or team"
          className="w-full max-w-xs rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary sm:w-64"
        />
        <div className="flex flex-wrap gap-1">
          {POS_FILTERS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => startTransition(() => setPos(p))}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-semibold",
                pos === p
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-blue-700",
              )}
            >
              {p === "DEF" ? "DST" : p}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
            <thead>
              <tr className={PLAYER_LIST_HEADER_ROW}>
                <th className="px-3 py-2 font-semibold text-slate-600">Player</th>
                <th className="px-3 py-2 font-semibold text-slate-600">Pos</th>
                <th className="px-3 py-2 font-semibold text-slate-600">NFL</th>
                <th className="px-3 py-2 font-semibold text-slate-600">Owner</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No players match these filters.
                  </td>
                </tr>
              ) : (
                rows.map(({ player, ownerTeamId }) => (
                  <PlayerRow
                    key={player.id}
                    player={player}
                    ownerLabel={
                      ownerTeamId == null
                        ? "Free agent"
                        : myTeamId != null && ownerTeamId === myTeamId
                          ? "My team"
                          : (teamNameById.get(ownerTeamId) ?? `Team ${ownerTeamId}`)
                    }
                    onOpen={() => modalRef.current?.open(player.id)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PlayerModalHost ref={modalRef} />
    </div>
  );
}

function PlayerRow({
  player,
  ownerLabel,
  onOpen,
}: {
  player: Player;
  ownerLabel: string;
  onOpen: () => void;
}) {
  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50/80">
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={onOpen}
          className="text-left font-medium text-slate-900 hover:text-primary hover:underline"
        >
          {player.name}
        </button>
      </td>
      <td className="px-3 py-2 text-slate-700">{player.pos === "DEF" ? "DST" : player.pos}</td>
      <td className="px-3 py-2 text-slate-700">{player.team || "—"}</td>
      <td className="px-3 py-2 text-slate-600">{ownerLabel}</td>
    </tr>
  );
}
