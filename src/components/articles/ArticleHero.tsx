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

function BrandMark({ compact }: { compact?: boolean }) {
  return (
    <img
      src={LEAGUE_LOGO_WHITE_SRC}
      alt=""
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute z-20 select-none object-contain drop-shadow-sm",
        compact ? "right-2 top-2 h-8 w-auto sm:h-9" : "right-3 top-3 h-10 w-auto sm:right-4 sm:top-4 sm:h-12",
      )}
    />
  );
}

/**
 * Article / card hero.
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
  const desk = articleHeroDeskCopy(category, title);

  if (chip && shot) {
    return (
      <div
        className={cn("relative w-full overflow-hidden aspect-[16/9]", className)}
        style={{
          background: `linear-gradient(100deg, ${teamColor} 0%, ${teamColor} 38%, color-mix(in srgb, ${teamColor} 35%, #ffffff) 62%, #ffffff 100%)`,
        }}
      >
        {logo ? (
          <img
            src={logo}
            alt=""
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute select-none object-contain opacity-[0.18]",
              compact
                ? "left-[6%] top-1/2 h-[88%] w-auto -translate-y-1/2"
                : "left-[4%] top-1/2 h-[98%] w-auto -translate-y-1/2",
            )}
          />
        ) : null}

        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0",
            compact ? "w-[46%]" : "w-[50%]",
          )}
        >
          <img
            src={shot}
            alt=""
            className={cn(
              "absolute bottom-0 left-1/2 max-h-full -translate-x-1/2 object-contain object-bottom",
              compact ? "h-[110%] w-auto" : "h-[115%] w-auto",
            )}
          />
        </div>

        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 flex flex-col justify-center",
            compact ? "w-[56%] pr-2 pl-1" : "w-[52%] pr-5 pl-2 sm:pr-10",
          )}
        >
          {desk ? (
            <div className={cn("w-full", compact ? "max-w-none" : "max-w-md")}>
              {desk.weekLabel ? (
                <p
                  className={cn(
                    "font-black uppercase tracking-[0.18em] text-slate-900",
                    compact ? "text-[9px] sm:text-[10px]" : "text-xs sm:text-sm",
                  )}
                >
                  {desk.weekLabel}
                </p>
              ) : null}
              <div
                className={cn(
                  "mt-1.5 w-full",
                  compact ? "px-2 py-1.5" : "px-3 py-2.5 sm:px-4 sm:py-3",
                )}
                style={{
                  background: `linear-gradient(90deg, ${teamColor} 0%, color-mix(in srgb, ${teamColor} 92%, #000) 100%)`,
                }}
              >
                <p
                  className={cn(
                    "display-title font-black uppercase leading-[0.92] tracking-tight text-white",
                    compact ? "text-xl sm:text-2xl" : "text-3xl sm:text-4xl md:text-5xl",
                  )}
                  style={{
                    WebkitTextStroke: compact ? "0.5px rgba(15,23,42,0.35)" : "1px rgba(15,23,42,0.4)",
                  }}
                >
                  {desk.title}
                </p>
                <p
                  className={cn(
                    "mt-1 font-semibold tracking-wide text-white/95",
                    compact ? "text-[10px] sm:text-xs" : "text-sm sm:text-base",
                  )}
                >
                  {desk.subtitle}
                </p>
              </div>
            </div>
          ) : (
            <p
              className={cn(
                "line-clamp-3 font-black uppercase leading-tight tracking-tight text-slate-900",
                compact ? "text-sm sm:text-base" : "text-xl sm:text-2xl md:text-3xl",
              )}
            >
              {title}
            </p>
          )}
        </div>

        <BrandMark compact={compact} />
      </div>
    );
  }

  return (
    <div
      className={cn("relative w-full overflow-hidden bg-slate-100 aspect-[16/9]", className)}
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
