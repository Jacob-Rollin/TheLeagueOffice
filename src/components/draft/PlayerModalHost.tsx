import { forwardRef, useImperativeHandle, useState } from "react";

import { PlayerModal } from "./PlayerModal";
import { prefetchPlayerDetail } from "@/lib/prefetch-player-detail";

export type PlayerModalHandle = { open: (id: string) => void; close: () => void };

/**
 * Owns the selected-player state locally so opening the modal never re-renders
 * the draft page (simulation loops, player table, clocks).
 */
export const PlayerModalHost = forwardRef<
  PlayerModalHandle,
  {
    showDraftActions?: boolean;
    /** Resolve mock-draft team name for the open player, if drafted. */
    resolveDraftRosterLabel?: (playerId: string) => string | null;
    /** Whether the open player is already drafted in this session. */
    isSessionDrafted?: (playerId: string) => boolean;
    /** Draft the player into this mock/war session (mock draft). */
    onSessionDraft?: (playerId: string) => void;
  }
>(function PlayerModalHost(
  { showDraftActions = false, resolveDraftRosterLabel, isSessionDrafted, onSessionDraft },
  ref,
) {
  const [id, setId] = useState<string | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      open: (playerId: string) => {
        prefetchPlayerDetail(playerId);
        setId(playerId);
      },
      close: () => setId(null),
    }),
    [],
  );

  const draftRosterLabel =
    id && resolveDraftRosterLabel ? resolveDraftRosterLabel(id) : showDraftActions ? null : undefined;
  const sessionDrafted = id && isSessionDrafted ? isSessionDrafted(id) : undefined;

  return (
    <PlayerModal
      id={id}
      onClose={() => setId(null)}
      onSelectPlayer={(playerId) => {
        prefetchPlayerDetail(playerId);
        setId(playerId);
      }}
      showDraftActions={showDraftActions}
      {...(draftRosterLabel !== undefined ? { draftRosterLabel } : {})}
      {...(sessionDrafted !== undefined ? { sessionDrafted } : {})}
      {...(onSessionDraft ? { onSessionDraft } : {})}
    />
  );
});
