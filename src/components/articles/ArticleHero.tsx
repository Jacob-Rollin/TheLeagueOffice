import { Link } from "@tanstack/react-router";

import { PlayerAvatar, playerImage, teamLogo } from "@/components/draft/PlayerAvatar";
import type { Pos } from "@/lib/draft";
import { cn } from "@/lib/utils";

export type ArticleHeroPlayer = {
  id: string;
  name: string;
  pos: string;
  team: string;
};

/** 16:9 stock background with optional featured-player overlap chip. */
export function ArticleHero({
  imageUrl,
  title,
  featured,
  className,
  compact = false,
}: {
  imageUrl: string;
  title: string;
  featured?: ArticleHeroPlayer | null;
  className?: string;
  /** Smaller chip for homepage cards. */
  compact?: boolean;
}) {
  const posRaw = (featured?.pos || "WR").toUpperCase();
  const avatarPos: Pos =
    posRaw === "DEF" || posRaw === "DST"
      ? "DEF"
      : posRaw === "QB" || posRaw === "RB" || posRaw === "WR" || posRaw === "TE" || posRaw === "K"
        ? posRaw
        : "WR";
  const team = featured?.team || "";
  const chip = featured?.id?.trim() ? featured : null;

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden bg-slate-100",
        compact ? "aspect-[16/9]" : "aspect-[16/9]",
        className,
      )}
    >
      <img src={imageUrl} alt={title} className="h-full w-full object-cover" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/55 via-slate-950/10 to-transparent" />
      {chip ? (
        <Link
          to="/player/$id"
          params={{ id: chip.id }}
          className={cn(
            "absolute z-10 flex items-center gap-3 rounded-xl border border-white/25 bg-slate-950/70 shadow-lg backdrop-blur-sm transition hover:border-blue-400/60 hover:bg-slate-950/85",
            compact
              ? "bottom-2 right-2 max-w-[70%] p-1.5 pr-2.5"
              : "bottom-4 right-4 max-w-[min(100%-2rem,20rem)] p-2.5 pr-4",
          )}
        >
          <PlayerAvatar
            id={chip.id}
            pos={avatarPos}
            team={team}
            name={chip.name}
            className={compact ? "size-10" : "size-14"}
            src={
              avatarPos === "DEF"
                ? teamLogo(team || chip.id)
                : playerImage(chip.id, avatarPos, team)
            }
          />
          <div className="min-w-0 text-left">
            <p
              className={cn(
                "truncate font-black uppercase tracking-tight text-white",
                compact ? "text-xs" : "text-sm sm:text-base",
              )}
            >
              {chip.name}
            </p>
            <p className={cn("font-semibold uppercase tracking-wider text-blue-200", compact ? "text-[9px]" : "text-[10px]")}>
              {[chip.pos, chip.team].filter(Boolean).join(" · ")}
            </p>
          </div>
        </Link>
      ) : null}
    </div>
  );
}

export function articleFeaturedFromRow(row: {
  featured_player_id?: string | null;
  featured_player_name?: string | null;
  featured_player_pos?: string | null;
  featured_player_team?: string | null;
}): ArticleHeroPlayer | null {
  const id = row.featured_player_id?.trim();
  if (!id) return null;
  return {
    id,
    name: row.featured_player_name?.trim() || "Featured player",
    pos: row.featured_player_pos?.trim() || "",
    team: row.featured_player_team?.trim() || "",
  };
}
