import type { ReactNode } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { injuryMicroBadge, resolveInjuryStatus } from "@/lib/sandbox-rosters";
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
 * Desktop Fantasy player cell — Playbook My Team style:
 * headshot + small corner team logo; injury micro-badge beside the name.
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
  // Match playbook.my-team roster thumbs (size-9/10 + logo size-3/3.5).
  const avatarSize = size === "sm" ? "size-9" : "size-10";
  const logoClassName = size === "sm" ? "size-3" : "size-3.5";
  const name = player?.name ?? fallbackName ?? "Empty";
  const pos = player?.pos === "DEF" ? "DST" : (player?.pos ?? null);
  const team = player?.team?.trim() || null;
  const injury = player
    ? resolveInjuryStatus(player) ?? player.injury_status ?? player.injury ?? null
    : null;
  const badge = injuryMicroBadge(injury);

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
            logoClassName={logoClassName}
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
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-slate-900">{name}</span>
          {badge ? (
            <span
              title={injury ?? badge.label}
              aria-label={`Injury status ${badge.label}`}
              className={cn(
                "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[2px] px-1 text-[9px] font-bold text-white",
                badge.className,
              )}
            >
              {badge.label}
            </span>
          ) : null}
        </span>
        {showMeta ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
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
