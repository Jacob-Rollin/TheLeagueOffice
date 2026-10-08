import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Toaster } from "@/components/ui/sonner";
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
import { useAuth } from "@/hooks/useAuth";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import {
  assignNativeOfflinePick,
  completeNativeDraft,
  getNativeDraftState,
  runNativeAiDraft,
  undoNativeOfflinePick,
} from "@/lib/native-league.functions";
import { loadPlayersCatalog } from "@/lib/players-catalog";
import type { Player } from "@/lib/players-build";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/league/$linkId/draft")({
  ssr: false,
  component: NativeLeagueDraftPage,
});

const buttonClass =
  "rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-60";
const outlineClass =
  "rounded-md border border-border bg-white px-4 py-2 font-display text-sm uppercase tracking-wide text-slate-800 disabled:opacity-60";

const POS_FILTERS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"] as const;

function NativeLeagueDraftPage() {
  const { linkId } = Route.useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const cache = useSleeperPlayers();
  const fallback = useQuery({
    queryKey: ["players-catalog"],
    queryFn: () => loadPlayersCatalog(),
    enabled: Boolean(cache.error) && !cache.data,
    staleTime: 1000 * 60 * 30,
  });
  const players = cache.data?.players ?? fallback.data?.players ?? [];

  const { data: draft, isLoading } = useQuery({
    queryKey: ["native-draft-state", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 15_000,
    refetchInterval: false,
    queryFn: () => getNativeDraftState({ data: { linkId } }),
  });

  const [teamId, setTeamId] = useState<number | "">("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [pos, setPos] = useState<(typeof POS_FILTERS)[number]>("ALL");
  const [busy, setBusy] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const drafted = useMemo(() => new Set(draft?.draftedPlayerIds ?? []), [draft?.draftedPlayerIds]);

  const available = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return players
      .filter((p) => !drafted.has(p.id))
      .filter((p) => (pos === "ALL" ? true : p.pos === pos || (pos === "DEF" && p.pos === "DEF")))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
      .slice(0, 80);
  }, [players, drafted, deferredQuery, pos]);

  const teamName = (id: number) => draft?.board.teams.find((t) => t.id === id)?.teamName ?? `Team ${id}`;

  useEffect(() => {
    if (teamId === "" && draft?.board.teams[0]) {
      setTeamId(draft.board.teams[0].id);
    }
  }, [draft?.board.teams, teamId]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["native-draft-state", linkId] });
    await queryClient.invalidateQueries({ queryKey: ["native-league-board", linkId] });
  };

  const assign = async (player: Player) => {
    if (!draft?.canAssign || busy) return;
    const tid = typeof teamId === "number" ? teamId : Number(teamId);
    if (!tid) {
      toast.error("Select a team first.");
      return;
    }
    setBusy(true);
    try {
      const result = await assignNativeOfflinePick({
        data: { linkId, teamId: tid, playerId: player.id },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Assigned ${player.name}`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not assign pick.");
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!draft?.canAssign || busy) return;
    setBusy(true);
    try {
      const result = await undoNativeOfflinePick({ data: { linkId } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Last pick undone.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not undo.");
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!draft?.board.canManage || busy) return;
    setBusy(true);
    try {
      const result = await completeNativeDraft({ data: { linkId } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Draft complete — season started.");
      setConfirmComplete(false);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not complete draft.");
    } finally {
      setBusy(false);
    }
  };

  const runAiPicks = async () => {
    if (!draft?.board.canManage || busy) return;
    setBusy(true);
    try {
      const result = await runNativeAiDraft({ data: { linkId, maxPicks: 40 } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const n = result.picks ?? 0;
      toast.success(
        n > 0
          ? `AI made ${n} pick${n === 1 ? "" : "s"}${result.stoppedReason === "human_on_clock" ? " (stopped on human seat)" : ""}.`
          : `No AI picks (${result.stoppedReason ?? "idle"}).`,
      );
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not run AI picks.");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading || !draft) {
    return <p className="text-sm text-muted-foreground">Loading draft board…</p>;
  }

  const { board, picks, totalPicks, canAssign, liveDraftDeferred } = draft;
  const done = board.summary.draftStatus === "complete";

  return (
    <div className="space-y-4">
      <Toaster />
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">
              {done ? "Draft Complete" : "Offline Draft Entry"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {done
                ? "Rosters and the regular-season schedule are locked in."
                : liveDraftDeferred
                  ? "Live snake clock comes later — enter picks here from your external draft (same offline board)."
                  : "Assign players to teams as you draft offline. Undo last pick anytime before you complete."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {picks.length}/{totalPicks} picks · {board.picksPerTeam} per team
            </p>
          </div>
          {!done && board.canManage ? (
            <div className="flex flex-wrap gap-2">
              {board.commissioner.allowAiTeams && board.teams.some((t) => t.isAi) ? (
                <button
                  type="button"
                  className={outlineClass}
                  disabled={busy}
                  onClick={() => void runAiPicks()}
                >
                  Run AI Picks
                </button>
              ) : null}
              <button type="button" className={outlineClass} disabled={busy || picks.length === 0} onClick={() => void undo()}>
                Undo Last
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={busy || picks.length === 0}
                onClick={() => setConfirmComplete(true)}
              >
                Complete Draft
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {!done && canAssign ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block min-w-[12rem] flex-1 text-sm font-medium text-slate-800">
                Assign to team
                <select
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={teamId}
                  onChange={(e) => setTeamId(Number(e.target.value))}
                >
                  {board.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      #{t.draftSlot} {t.teamName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block min-w-[12rem] flex-[2] text-sm font-medium text-slate-800">
                Search players
                <input
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name or team"
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {POS_FILTERS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPos(p)}
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
            <ul className="mt-4 max-h-[28rem] space-y-1 overflow-y-auto">
              {available.map((player) => (
                <li
                  key={player.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1.5 hover:border-border hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{player.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {player.pos === "DEF" ? "DST" : player.pos} · {player.team || "FA"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy}
                    onClick={() => void assign(player)}
                  >
                    Assign
                  </button>
                </li>
              ))}
              {available.length === 0 ? (
                <li className="px-2 py-6 text-sm text-muted-foreground">No matching available players.</li>
              ) : null}
            </ul>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-900">Pick Log</h3>
            <ol className="mt-3 max-h-[32rem] space-y-1 overflow-y-auto text-sm">
              {[...picks].reverse().map((pick) => {
                const player = pick.playerId ? byId.get(pick.playerId) : null;
                return (
                  <li key={pick.pickNumber} className="border-t border-border py-1.5">
                    <span className="font-mono text-xs text-muted-foreground">#{pick.pickNumber}</span>{" "}
                    <span className="font-medium">{player?.name ?? pick.playerId}</span>
                    <div className="text-xs text-muted-foreground">{teamName(pick.teamId)}</div>
                  </li>
                );
              })}
              {picks.length === 0 ? (
                <li className="py-4 text-muted-foreground">No picks yet.</li>
              ) : null}
            </ol>
          </section>
        </div>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-900">Pick Log</h3>
          <ol className="mt-3 columns-1 gap-4 sm:columns-2 text-sm">
            {picks.map((pick) => {
              const player = pick.playerId ? byId.get(pick.playerId) : null;
              return (
                <li key={pick.pickNumber} className="mb-1 break-inside-avoid">
                  <span className="font-mono text-xs text-muted-foreground">#{pick.pickNumber}</span>{" "}
                  {player?.name ?? pick.playerId}{" "}
                  <span className="text-muted-foreground">· {teamName(pick.teamId)}</span>
                </li>
              );
            })}
          </ol>
          {!canAssign && !done ? (
            <p className="mt-4 text-sm text-muted-foreground">Only commissioners can assign offline picks.</p>
          ) : null}
        </section>
      )}

      <AlertDialog open={confirmComplete} onOpenChange={setConfirmComplete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Rosters will be written from the pick log, player locks applied, and a regular-season schedule
              generated. This cannot be undone from the UI.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-primary text-primary-foreground"
              onClick={(e) => {
                e.preventDefault();
                void complete();
              }}
            >
              {busy ? "Completing…" : "Complete Draft"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
