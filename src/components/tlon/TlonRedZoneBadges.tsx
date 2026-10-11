import { playerImage } from "@/components/draft/PlayerAvatar";
import type { Pos } from "@/lib/draft";
import type { TlonFeedSide } from "@/lib/tlon-play-feed";
import { cn } from "@/lib/utils";

/** Same yard mapping as TlonField — badges sit inside each side’s 20 (~12 yd). */
const EZ = 8;
const PLAYABLE = 100 - EZ * 2;
function yardToPct(yardsFromLeftGoal: number): number {
  return EZ + (yardsFromLeftGoal / 100) * PLAYABLE;
}
/** ~12-yard line: clear of goal line, still inside the painted 20. */
const LEFT_RZ_PCT = yardToPct(12);
const RIGHT_RZ_PCT = yardToPct(88);
const MAX_PER_SIDE = 3;

export type TlonRedZonePlayer = {
  playerId: string;
  playerName: string;
  pos: string;
  team: string;
  side: TlonFeedSide;
};

function RzChip({
  player,
  expanded,
}: {
  player: TlonRedZonePlayer;
  expanded?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full border border-rose-500/50 bg-[#0b1220]/92 shadow-lg backdrop-blur-md",
        expanded ? "px-2 py-1 sm:gap-2 sm:px-2.5 sm:py-1.5" : "px-1.5 py-0.5",
      )}
      title={`${player.playerName} — red zone`}
    >
      <img
        src={playerImage(player.playerId, (player.pos || "WR") as Pos, player.team)}
        alt=""
        className={cn(
          "shrink-0 rounded-full border border-white/30 object-cover",
          expanded ? "size-7 sm:size-8" : "size-5 sm:size-6",
        )}
        onError={(e) => {
          e.currentTarget.style.visibility = "hidden";
        }}
      />
      <span
        className={cn(
          "min-w-0 truncate font-semibold text-white",
          expanded ? "max-w-[7rem] text-[12px] sm:max-w-[8.5rem] sm:text-[13px]" : "max-w-[5.5rem] text-[10px] sm:text-[11px]",
        )}
      >
        {player.playerName}
      </span>
      <span
        className={cn(
          "shrink-0 rounded bg-rose-600 font-display font-extrabold uppercase tracking-wider text-white",
          expanded ? "px-1.5 py-0.5 text-[10px] sm:text-[11px]" : "px-1 py-px text-[9px]",
        )}
      >
        RZ
      </span>
    </div>
  );
}

/**
 * Live red-zone markers inside each side’s 20 — starters whose NFL team
 * currently has possession in the red zone (ESPN scoreboard signal).
 * Parent feeds a continuous list for the full possession+RZ window; chips
 * are not toast-timed and clear only when the feed drops the player.
 */
export function TlonRedZoneBadges({
  players,
  expanded = false,
}: {
  players: TlonRedZonePlayer[];
  expanded?: boolean;
}) {
  const left = players.filter((p) => p.side === "left").slice(0, MAX_PER_SIDE);
  const right = players.filter((p) => p.side === "right").slice(0, MAX_PER_SIDE);

  if (!left.length && !right.length) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 bottom-[4%] z-[25] overflow-hidden">
      {left.length ? (
        <div
          className={cn(
            "absolute top-[58%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center",
            expanded ? "gap-1.5" : "gap-1",
          )}
          style={{ left: `${LEFT_RZ_PCT}%` }}
        >
          {left.map((p) => (
            <RzChip key={`rz-${p.side}-${p.playerId}`} player={p} expanded={expanded} />
          ))}
        </div>
      ) : null}
      {right.length ? (
        <div
          className={cn(
            "absolute top-[58%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center",
            expanded ? "gap-1.5" : "gap-1",
          )}
          style={{ left: `${RIGHT_RZ_PCT}%` }}
        >
          {right.map((p) => (
            <RzChip key={`rz-${p.side}-${p.playerId}`} player={p} expanded={expanded} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
