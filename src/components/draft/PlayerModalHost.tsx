import { forwardRef, useImperativeHandle, useState } from "react";

import { PlayerModal } from "./PlayerModal";

export type PlayerModalHandle = { open: (id: string) => void; close: () => void };

/**
 * Owns the selected-player state locally so opening the modal never re-renders
 * the draft page (simulation loops, player table, clocks).
 */
export const PlayerModalHost = forwardRef<PlayerModalHandle>(function PlayerModalHost(_props, ref) {
  const [id, setId] = useState<string | null>(null);
  useImperativeHandle(ref, () => ({ open: setId, close: () => setId(null) }), []);
  return <PlayerModal id={id} onClose={() => setId(null)} onSelectPlayer={setId} />;
});
