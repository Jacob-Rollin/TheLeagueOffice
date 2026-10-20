import { playerImage, teamLogo } from "@/components/draft/PlayerAvatar";
import type { Pos } from "@/lib/draft";
import { getTeamPrimaryColor } from "@/lib/nfl-teams";
import { cn } from "@/lib/utils";

/** White ink wordmark (transparent fill) — not a CSS-inverted solid oval. */
const LEAGUE_LOGO_WHITE_SRC = "/the-league-logo-white.png";

export type ArticleHeroPlayer = {
  id: string;
  name: string;
  pos: string;
  team: string;
};

export type ArticleHeroDesk = {
  weekLabel: string | null;
  title: string;
  subtitle: string;
};

/** Visual density for article / list / admin thumbnails. */
export type ArticleHeroDensity = "default" | "compact" | "micro";

function normalizePos(posRaw: string): Pos {
  const pos = (posRaw || "WR").toUpperCase();
  if (pos === "DEF" || pos === "DST") return "DEF";
  if (pos === "QB" || pos === "RB" || pos === "WR" || pos === "TE" || pos === "K") return pos;
  return "WR";
}

export function articleHeroWeekLabel(title?: string | null): string | null {
  const m = String(title ?? "").match(/\bweek\s+(\d+)\b/i);
  return m?.[1] ? `WEEK ${m[1]}` : null;
}

/**
 * Desk chrome for the right-side hero type (matches Broadcast A/B demos).
 * Wire → WEEK N / THE WIRE / Waiver Wire Targets
 * Start/Sit → WEEK N / START / SIT / Weekly Lineup Advice
 */
export function articleHeroDeskCopy(
  category?: string | null,
  title?: string | null,
): ArticleHeroDesk | null {
  const cat = (category || "").trim().toLowerCase();
  const t = (title || "").trim().toLowerCase();
  const weekLabel = articleHeroWeekLabel(title);
  if (cat.includes("waiver") || t.includes("waiver")) {
    return { weekLabel, title: "THE WIRE", subtitle: "Waiver Wire Targets" };
  }
  if (cat.includes("start") || t.includes("start / sit") || t.includes("start/sit")) {
    return { weekLabel, title: "START / SIT", subtitle: "Weekly Lineup Advice" };
  }
  return null;
}

function BrandMark({ density }: { density: ArticleHeroDensity }) {
  if (density === "micro") return null;
  return (
    <img
      src={LEAGUE_LOGO_WHITE_SRC}
      alt=""
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute z-20 select-none object-contain drop-shadow-sm",
        density === "compact"
          ? "right-1 top-1 h-5 w-auto sm:right-1.5 sm:top-1.5 sm:h-6"
          : "right-3 top-3 h-10 w-auto sm:right-4 sm:top-4 sm:h-12",
      )}
    />
  );
}

/**
 * Article / card / list hero.
 * Featured: team→white gradient, cutout, faded team logo, desk type on a
 * team-color title band, white League wordmark upper-right (no tile watermark).
 */
export function ArticleHero({
  imageUrl,
  title,
  category,
  featured,
  className,
  compact = false,
  density: densityProp,
  fill = false,
}: {
  imageUrl?: string | null;
  title: string;
  category?: string | null;
  featured?: ArticleHeroPlayer | null;
  className?: string;
  /** @deprecated Prefer `density="compact"`. */
  compact?: boolean;
  /** default = full hero; compact = homepage rows; micro = admin thumbs. */
  density?: ArticleHeroDensity;
  /** Fill parent instead of locking 16:9 (list / admin thumbs). */
  fill?: boolean;
}) {
  const density: ArticleHeroDensity = densityProp ?? (compact ? "compact" : "default");
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
  const desk = articleHeroDeskCopy(category, title);
  const frame = cn(
    "relative w-full overflow-hidden",
    !fill && "aspect-[16/9]",
    fill && "h-full",
    className,
  );

  if (chip && shot) {
    const isMicro = density === "micro";
    const isCompact = density === "compact";
    return (
      <div
        className={frame}
        style={{
          background: isMicro
            ? `linear-gradient(135deg, ${teamColor} 0%, color-mix(in srgb, ${teamColor} 70%, #0f172a) 100%)`
            : `linear-gradient(100deg, ${teamColor} 0%, ${teamColor} 38%, color-mix(in srgb, ${teamColor} 35%, #ffffff) 62%, #ffffff 100%)`,
        }}
      >
        {logo ? (
          <img
            src={logo}
            alt=""
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute select-none object-contain",
              isMicro
                ? "left-1/2 top-1/2 h-[120%] w-auto -translate-x-1/2 -translate-y-1/2 opacity-[0.22]"
                : isCompact
                  ? "left-[4%] top-1/2 h-[90%] w-auto -translate-y-1/2 opacity-[0.18]"
                  : "left-[4%] top-1/2 h-[98%] w-auto -translate-y-1/2 opacity-[0.18]",
            )}
          />
        ) : null}

        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0",
            isMicro ? "w-full" : isCompact ? "w-[48%]" : "w-[50%]",
          )}
        >
          <img
            src={shot}
            alt=""
            className={cn(
              "absolute bottom-0 max-h-full object-contain object-bottom",
              isMicro
                ? "left-1/2 h-[115%] w-auto -translate-x-1/2"
                : isCompact
                  ? "left-1/2 h-[112%] w-auto -translate-x-1/2"
                  : "left-1/2 h-[115%] w-auto -translate-x-1/2",
            )}
          />
        </div>

        {!isMicro ? (
          <div
            className={cn(
              "pointer-events-none absolute inset-y-0 right-0 flex flex-col justify-center",
              isCompact ? "w-[54%] pr-1.5 pl-0.5" : "w-[52%] pr-5 pl-2 sm:pr-10",
            )}
          >
            {desk ? (
              <div className="w-full">
                {desk.weekLabel ? (
                  <p
                    className={cn(
                      "font-black uppercase tracking-[0.14em] text-slate-900",
                      isCompact ? "text-[7px] leading-none sm:text-[8px]" : "text-xs sm:text-sm",
                    )}
                  >
                    {desk.weekLabel}
                  </p>
                ) : null}
                <div
                  className={cn("mt-0.5 w-full", isCompact ? "px-1 py-0.5" : "mt-1.5 px-3 py-2.5 sm:px-4 sm:py-3")}
                  style={{
                    background: `linear-gradient(90deg, ${teamColor} 0%, color-mix(in srgb, ${teamColor} 92%, #000) 100%)`,
                  }}
                >
                  <p
                    className={cn(
                      "display-title font-black uppercase leading-[0.92] tracking-tight text-white",
                      isCompact ? "text-[10px] sm:text-xs" : "text-3xl sm:text-4xl md:text-5xl",
                    )}
                    style={
                      isCompact
                        ? undefined
                        : { WebkitTextStroke: "1px rgba(15,23,42,0.4)" }
                    }
                  >
                    {desk.title}
                  </p>
                  {!isCompact ? (
                    <p className="mt-1 text-sm font-semibold tracking-wide text-white/95 sm:text-base">
                      {desk.subtitle}
                    </p>
                  ) : (
                    <p className="mt-0.5 truncate text-[7px] font-semibold leading-tight text-white/90 sm:text-[8px]">
                      {desk.subtitle}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p
                className={cn(
                  "line-clamp-3 font-black uppercase leading-tight tracking-tight text-slate-900",
                  isCompact ? "text-[9px]" : "text-xl sm:text-2xl md:text-3xl",
                )}
              >
                {title}
              </p>
            )}
          </div>
        ) : null}

        <BrandMark density={density} />
      </div>
    );
  }

  const cover = (imageUrl || "").trim();
  if (!cover) {
    return <div className={cn(frame, "bg-slate-200")} aria-hidden="true" />;
  }

  return (
    <div className={cn(frame, "bg-slate-100")}>
      <img src={cover} alt={title} className="h-full w-full object-cover" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/55 via-slate-950/10 to-transparent" />
      <BrandMark density={density} />
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
