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
  commissionerEditNativeRoster,
  getNativeLeagueBoard,
  kickNativeTeamMember,
  renameNativeTeam,
  runNativeAiLineups,
  setNativeTeamAi,
} from "@/lib/native-league.functions";
import { loadPlayersCatalog } from "@/lib/players-catalog";
import type { Player } from "@/lib/players-build";

export const Route = createFileRoute("/league/$linkId/teams")({
  ssr: false,
  component: NativeLeagueTeamsPage,
});

const buttonClass =
  "rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60";
const outlineClass =
  "rounded-md border border-border bg-white px-3 py-1.5 text-xs font-medium text-foreground disabled:opacity-60";

function NativeLeagueTeamsPage() {
  const { linkId } = Route.useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pendingKick, setPendingKick] = useState<{ id: number; name: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [rosterTeamId, setRosterTeamId] = useState<number | "">("");
  const [rosterQuery, setRosterQuery] = useState("");
  const deferredRosterQuery = useDeferredValue(rosterQuery);
  const [rosterBusy, setRosterBusy] = useState(false);

  const cache = useSleeperPlayers();
  const fallback = useQuery({
    queryKey: ["players-catalog"],
    queryFn: () => loadPlayersCatalog(),
    enabled: Boolean(cache.error) && !cache.data,
    staleTime: 1000 * 60 * 30,
  });
  const players = cache.data?.players ?? fallback.data?.players ?? [];

  const { data: board } = useQuery({
    queryKey: ["native-league-board", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 60_000,
    queryFn: () => getNativeLeagueBoard({ data: { linkId } }),
  });

  useEffect(() => {
    if (rosterTeamId === "" && board?.teams[0]) {
      setRosterTeamId(board.teams[0].id);
    }
  }, [board?.teams, rosterTeamId]);

  const ownedIds = useMemo(() => new Set(Object.keys(board?.ownership ?? {})), [board?.ownership]);
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const rosterTeamPlayers = useMemo(() => {
    if (!board || rosterTeamId === "") return [] as string[];
    const row = board.rosters.find((r) => r.teamId === rosterTeamId);
    return row?.playerIds ?? [];
  }, [board, rosterTeamId]);

  const availableForRoster = useMemo(() => {
    const q = deferredRosterQuery.trim().toLowerCase();
    return players
      .filter((p) => !ownedIds.has(p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
      .slice(0, 40);
  }, [players, ownedIds, deferredRosterQuery]);

  if (!board) return null;

  const allowAi = Boolean(board.commissioner.allowAiTeams);
  const aiTeamCount = board.teams.filter((t) => t.isAi).length;
  const capacity = board.rosterCapacity;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["native-league-board", linkId] });
    void queryClient.invalidateQueries({ queryKey: ["native-league-summary", linkId] });
    void queryClient.invalidateQueries({ queryKey: ["native-league-summaries"] });
    void queryClient.invalidateQueries({ queryKey: ["native-draft-state", linkId] });
  };

  const saveName = async (teamId: number) => {
    setBusyId(teamId);
    try {
      const result = await renameNativeTeam({
        data: { linkId, teamId, teamName: draftName },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Team renamed.");
      setEditingId(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not rename team.");
    } finally {
      setBusyId(null);
    }
  };

  const confirmKick = async () => {
    if (!pendingKick) return;
    setBusyId(pendingKick.id);
    try {
      const result = await kickNativeTeamMember({
        data: { linkId, teamId: pendingKick.id },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Seat opened.");
      setPendingKick(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open seat.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleAi = async (teamId: number, enabled: boolean) => {
    setBusyId(teamId);
    try {
      const result = await setNativeTeamAi({ data: { linkId, teamId, enabled } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        enabled
          ? "AI manager assigned."
          : "AI removed — seat is open.",
      );
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update AI seat.");
    } finally {
      setBusyId(null);
    }
  };

  const setAiLineups = async () => {
    if (aiBusy) return;
    setAiBusy(true);
    try {
      const result = await runNativeAiLineups({ data: { linkId } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Updated lineups for ${result.teams ?? 0} AI team(s).`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not set AI lineups.");
    } finally {
      setAiBusy(false);
    }
  };

  const addToRoster = async (player: Player) => {
    if (!board.canManage || rosterTeamId === "" || rosterBusy) return;
    setRosterBusy(true);
    try {
      const result = await commissionerEditNativeRoster({
        data: { linkId, teamId: Number(rosterTeamId), addPlayerId: player.id },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Added ${player.name}`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add player.");
    } finally {
      setRosterBusy(false);
    }
  };

  const dropFromRoster = async (playerId: string) => {
    if (!board.canManage || rosterTeamId === "" || rosterBusy) return;
    setRosterBusy(true);
    try {
      const result = await commissionerEditNativeRoster({
        data: { linkId, teamId: Number(rosterTeamId), dropPlayerId: playerId },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Player dropped from roster.");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not drop player.");
    } finally {
      setRosterBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <Toaster />
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">Teams</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Rename seats
          {board.canManage
            ? allowAi
              ? ", open claimed seats, or assign AI managers anytime for testing"
              : " and open claimed seats"
            : ""}
          .
        </p>
        {board.canManage && allowAi ? (
          <p className="mt-2 text-xs text-muted-foreground">
            AI managers draft by ADP and set weekly lineups (sit bye / Out / IR). Enable in Settings
            first. {aiTeamCount} AI seat{aiTeamCount === 1 ? "" : "s"} assigned.
            {board.summary.draftStatus === "complete" ? (
              <>
                {" "}
                <button
                  type="button"
                  className="font-medium text-primary hover:underline disabled:opacity-60"
                  disabled={aiBusy || aiTeamCount === 0}
                  onClick={() => void setAiLineups()}
                >
                  {aiBusy ? "Setting lineups…" : "Set AI lineups now"}
                </button>
              </>
            ) : null}
          </p>
        ) : null}

        <ul className="mt-4 divide-y divide-border">
          {board.teams.map((team) => {
            const canRename =
              board.canManage || (user?.id != null && team.userId === user.id);
            const editing = editingId === team.id;
            const seatLabel = team.isAi
              ? `AI manager${team.aiPersona ? ` · ${team.aiPersona}` : ""}`
              : team.userId
                ? "Claimed"
                : "Open seat";
            const isOwnSeat = user?.id != null && team.userId === user.id;
            return (
              <li key={team.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="w-8 text-xs font-semibold text-muted-foreground">
                  #{team.draftSlot}
                </span>
                <div className="min-w-0 flex-1">
                  {editing ? (
                    <input
                      className="w-full max-w-xs rounded-md border border-border px-2 py-1.5 text-sm"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      maxLength={64}
                    />
                  ) : (
                    <>
                      <p className="truncate font-medium text-slate-900">{team.teamName}</p>
                      <p className="text-xs text-muted-foreground">{seatLabel}</p>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {editing ? (
                    <>
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={busyId === team.id || draftName.trim().length < 1}
                        onClick={() => void saveName(team.id)}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className={outlineClass}
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      {canRename ? (
                        <button
                          type="button"
                          className={outlineClass}
                          onClick={() => {
                            setEditingId(team.id);
                            setDraftName(team.teamName);
                          }}
                        >
                          Rename
                        </button>
                      ) : null}
                      {board.canManage && team.userId && !team.isAi ? (
                        <button
                          type="button"
                          className={`${outlineClass} text-red-600`}
                          onClick={() => setPendingKick({ id: team.id, name: team.teamName })}
                        >
                          Open Seat
                        </button>
                      ) : null}
                      {board.canManage && allowAi && !team.isAi && !isOwnSeat ? (
                        <button
                          type="button"
                          className={outlineClass}
                          disabled={busyId === team.id}
                          onClick={() => void toggleAi(team.id, true)}
                        >
                          {team.userId ? "Make AI" : "Assign AI"}
                        </button>
                      ) : null}
                      {board.canManage && team.isAi ? (
                        <button
                          type="button"
                          className={`${outlineClass} text-red-600`}
                          disabled={busyId === team.id}
                          onClick={() => void toggleAi(team.id, false)}
                        >
                          Remove AI
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {board.canManage ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">
            Manual Roster Editor
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Skip drafting: select a team, search free agents, and add players directly. Capacity{" "}
            {capacity} active spots. When ready, Complete Draft on the Draft tab (pick a start week).
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="block min-w-[12rem] text-sm font-medium text-slate-800">
              Team
              <select
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                value={rosterTeamId}
                onChange={(e) => setRosterTeamId(Number(e.target.value))}
              >
                {board.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    #{t.draftSlot} {t.teamName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-[12rem] flex-1 text-sm font-medium text-slate-800">
              Search free agents
              <input
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                value={rosterQuery}
                onChange={(e) => setRosterQuery(e.target.value)}
                placeholder="Name or team"
              />
            </label>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">
                On roster ({rosterTeamPlayers.length}/{capacity})
              </h3>
              <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
                {rosterTeamPlayers.map((id) => {
                  const p = byId.get(id);
                  return (
                    <li
                      key={id}
                      className="flex items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1.5 hover:border-border hover:bg-muted/40"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {p?.name ?? id}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {p ? `${p.pos === "DEF" ? "DST" : p.pos} · ${p.team || "FA"}` : "—"}
                        </p>
                      </div>
                      <button
                        type="button"
                        className={`${outlineClass} text-red-600`}
                        disabled={rosterBusy}
                        onClick={() => void dropFromRoster(id)}
                      >
                        Drop
                      </button>
                    </li>
                  );
                })}
                {rosterTeamPlayers.length === 0 ? (
                  <li className="py-4 text-sm text-muted-foreground">No players yet.</li>
                ) : null}
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">
                Available
              </h3>
              <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
                {availableForRoster.map((player) => (
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
                      disabled={rosterBusy || rosterTeamPlayers.length >= capacity}
                      onClick={() => void addToRoster(player)}
                    >
                      Add
                    </button>
                  </li>
                ))}
                {availableForRoster.length === 0 ? (
                  <li className="py-4 text-sm text-muted-foreground">No matching free agents.</li>
                ) : null}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      <AlertDialog open={pendingKick != null} onOpenChange={(o) => !o && setPendingKick(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Open this seat?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingKick
                ? `Remove the manager from "${pendingKick.name}" so someone else can join with the invite code?`
                : "Remove this manager from the seat?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                void confirmKick();
              }}
            >
              Open Seat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
