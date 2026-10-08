import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import {
  getNativeLeagueBoard,
  kickNativeTeamMember,
  renameNativeTeam,
} from "@/lib/native-league.functions";

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

  const { data: board } = useQuery({
    queryKey: ["native-league-board", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 60_000,
    queryFn: () => getNativeLeagueBoard({ data: { linkId } }),
  });

  if (!board) return null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["native-league-board", linkId] });
    void queryClient.invalidateQueries({ queryKey: ["native-league-summary", linkId] });
    void queryClient.invalidateQueries({ queryKey: ["native-league-summaries"] });
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

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <Toaster />
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">Teams</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Rename seats{board.canManage && !board.settingsLocked ? " and open claimed seats before the draft" : ""}.
      </p>

      <ul className="mt-4 divide-y divide-border">
        {board.teams.map((team) => {
          const canRename =
            board.canManage || (user?.id != null && team.userId === user.id);
          const editing = editingId === team.id;
          return (
            <li key={team.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="w-8 text-xs font-semibold text-muted-foreground">#{team.draftSlot}</span>
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
                    <p className="text-xs text-muted-foreground">{team.userId ? "Claimed" : "Open seat"}</p>
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
                    <button type="button" className={outlineClass} onClick={() => setEditingId(null)}>
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
                    {board.canManage && !board.settingsLocked && team.userId ? (
                      <button
                        type="button"
                        className={`${outlineClass} text-red-600`}
                        onClick={() => setPendingKick({ id: team.id, name: team.teamName })}
                      >
                        Open Seat
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

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
    </section>
  );
}
