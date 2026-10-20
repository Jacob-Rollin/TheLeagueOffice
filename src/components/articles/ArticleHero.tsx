import { playerImage, teamLogo } from "@/components/draft/PlayerAvatar";
import type { Pos } from "@/lib/draft";
import { getTeamPrimaryColor } from "@/lib/nfl-teams";
import { cn } from "@/lib/utils";

const LEAGUE_LOGO_SRC = "/the-league-logo.png";

export type ArticleHeroPlayer = {
  id: string;
  name: string;
  pos: string;
  team: string;
};

function normalizePos(posRaw: string): Pos {
  const pos = (posRaw || "WR").toUpperCase();
  if (pos === "DEF" || pos === "DST") return "DEF";
  if (pos === "QB" || pos === "RB" || pos === "WR" || pos === "TE" || pos === "K") return pos;
  return "WR";
}

/** Short desk label for the right-side hero type (Broadcast A/B layout). */
export function articleHeroDeskLabel(category?: string | null, title?: string | null): string | null {
  const cat = (category || "").trim().toLowerCase();
  const t = (title || "").trim().toLowerCase();
  if (cat.includes("waiver") || t.includes("waiver")) return "The Wire";
  if (cat.includes("start") || t.includes("start / sit") || t.includes("start/sit")) {
    return "Start / Sit Advice";
  }
  return null;
}

function BrandMark({ compact }: { compact?: boolean }) {
  return (
    <img
      src={LEAGUE_LOGO_SRC}
      alt=""
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute z-20 select-none object-contain opacity-95",
        /* White mark — no tiled watermark pattern */
        "brightness-0 invert",
        compact ? "right-2 top-2 h-7 w-auto sm:h-8" : "right-3 top-3 h-9 w-auto sm:right-4 sm:top-4 sm:h-11",
      )}
    />
  );
}

/**
 * Article / card hero.
 * With a featured player: team-color wash, large cutout, faded team logo,
 * desk title on the right, white League logo upper-right (no badge chip).
 * Without: stock cover + white League logo upper-right.
 */
export function ArticleHero({
  imageUrl,
  title,
  category,
  featured,
  className,
  compact = false,
}: {
  imageUrl: string;
  title: string;
  category?: string | null;
  featured?: ArticleHeroPlayer | null;
  className?: string;
  /** Smaller chrome for tight cards. */
  compact?: boolean;
}) {
  const chip = featured?.id?.trim() ? featured : null;
  const avatarPos = normalizePos(chip?.pos || "WR");
  const team = chip?.team || "";
  const teamColor = getTeamPrimaryColor(team);
  const logo = team ? teamLogo(team) : null;
  const shot =
    chip &&
    (avatarPos === "DEF"
      ? teamLogo(team || chip.id)
      : playerImage(chip.id, avatarPos, team));
  const deskLabel = articleHeroDeskLabel(category, title);

  if (chip && shot) {
    return (
      <div
        className={cn(
          "relative w-full overflow-hidden",
          compact ? "aspect-[16/9]" : "aspect-[16/9]",
          className,
        )}
        style={{
          background: `linear-gradient(105deg, ${teamColor} 0%, ${teamColor} 42%, color-mix(in srgb, ${teamColor} 55%, #0f172a) 72%, #0f172a 100%)`,
        }}
      >
        {logo ? (
          <img
            src={logo}
            alt=""
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute select-none object-contain opacity-[0.16]",
              compact
                ? "left-[8%] top-1/2 h-[85%] w-auto -translate-y-1/2"
                : "left-[6%] top-1/2 h-[95%] w-auto -translate-y-1/2",
            )}
          />
        ) : null}

        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 flex items-end",
            compact ? "w-[48%]" : "w-[52%]",
          )}
        >
          <img
            src={shot}
            alt=""
            className={cn(
              "absolute bottom-0 left-1/2 max-h-full -translate-x-1/2 object-contain object-bottom",
              compact ? "h-[108%] w-auto" : "h-[112%] w-auto",
            )}
          />
        </div>

        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 flex flex-col justify-center",
            compact ? "w-[54%] pr-3 pl-2" : "w-[50%] pr-6 pl-3 sm:pr-10",
          )}
        >
          {deskLabel ? (
            <>
              <p
                className={cn(
                  "font-semibold uppercase tracking-[0.2em] text-white/70",
                  compact ? "text-[8px]" : "text-[10px] sm:text-xs",
                )}
              >
                League Office
              </p>
              <p
                className={cn(
                  "display-title mt-1 font-black uppercase leading-[0.95] tracking-tight text-white drop-shadow-sm",
                  compact ? "text-lg sm:text-xl" : "text-2xl sm:text-3xl md:text-4xl",
                )}
              >
                {deskLabel}
              </p>
            </>
          ) : (
            <p
              className={cn(
                "line-clamp-3 font-black uppercase leading-tight tracking-tight text-white drop-shadow-sm",
                compact ? "text-sm sm:text-base" : "text-xl sm:text-2xl md:text-3xl",
              )}
            >
              {title}
            </p>
          )}
          {!compact && chip.name ? (
            <p className="mt-2 truncate text-xs font-semibold uppercase tracking-wide text-white/75 sm:text-sm">
              {[chip.pos, chip.team].filter(Boolean).join(" · ") || chip.name}
            </p>
          ) : null}
        </div>

        <BrandMark compact={compact} />
      </div>
    );
  }

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
      <BrandMark compact={compact} />
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
