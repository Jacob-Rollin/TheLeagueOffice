import { ArrowRight } from "lucide-react";

import { useFantasyRosterTeamName } from "@/hooks/useFantasyRosterTeamName";

/** Small "→ Team Name" chip above a player name when rostered in the active league. */
export function RosteredOnLabel({
  playerId,
  playerName,
}: {
  playerId: string;
  playerName?: string | null;
}) {
  const teamName = useFantasyRosterTeamName(playerId, playerName);
  if (!teamName) return null;

  return (
    <div className="mb-0.5 flex min-w-0 max-w-full items-center gap-1 text-[11px] font-semibold leading-none text-white/90 [text-shadow:0_1px_2px_rgba(0,0,0,0.55)]">
      <ArrowRight className="size-3 shrink-0 drop-shadow-sm" strokeWidth={2.5} aria-hidden="true" />
      <span className="truncate">{teamName}</span>
    </div>
  );
}
