import type { ReactNode } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { InjuryAvatarBadge } from "@/components/injury/InjuryAvatarBadge";
import { resolveInjuryStatus } from "@/lib/sandbox-rosters";
import { cn } from "@/lib/utils";

type PlayerLike = {
  id: string;
  name: string;
  team?: string | null;
  pos?: string | null;
  injury_status?: string | null;
  injury?: string | null;
};

type FantasyPlayerChipProps = {
  player: PlayerLike | null | undefined;
  /** Fallback label when player catalog miss. */
  fallbackName?: string | null;
  size?: "sm" | "md";
  onClick?: () => void;
  trailing?: ReactNode;
  className?: string;
  /** Show team · pos under the name (default true). */
  showMeta?: boolean;
};

/**
 * Desktop Fantasy player cell: avatar + injury badge + name/meta.
 * Mirrors mobile native league lists without mobile-theme tokens.
 */
export function FantasyPlayerChip({
  player,
  fallbackName,
  size = "md",
  onClick,
  trailing,
  className,
  showMeta = true,
}: FantasyPlayerChipProps) {
  const avatarSize = size === "sm" ? "size-8" : "size-10";
  const name = player?.name ?? fallbackName ?? "Empty";
  const pos = player?.pos === "DEF" ? "DST" : (player?.pos ?? null);
  const team = player?.team?.trim() || null;
  const injury = player
    ? resolveInjuryStatus(player) ?? player.injury_status ?? player.injury ?? null
    : null;

  const body = (
    <>
      <span className={cn("relative shrink-0", avatarSize)}>
        {player ? (
          <PlayerAvatar
            id={player.id}
            name={player.name}
            team={player.team ?? ""}
            pos={(player.pos as "QB" | "RB" | "WR" | "TE" | "K" | "DEF") || "WR"}
            className={cn(avatarSize, "rounded-full")}
          />
        ) : (
          <span
            className={cn(
              avatarSize,
              "flex items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-400",
            )}
          >
            —
          </span>
        )}
        <InjuryAvatarBadge status={injury} className="ring-white" />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-semibold text-slate-900">{name}</span>
        {showMeta ? (
          <span className="block truncate text-xs text-muted-foreground">
            {[pos, team].filter(Boolean).join(" · ") || "—"}
          </span>
        ) : null}
      </span>
      {trailing}
    </>
  );

  return (
    <span
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left",
        onClick && "cursor-pointer transition-colors hover:bg-slate-50/80",
        className,
      )}
    >
      {body}
    </span>
  );
}
