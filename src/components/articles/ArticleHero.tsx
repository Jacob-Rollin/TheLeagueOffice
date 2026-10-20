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

export type ArticleHeroDeskKind = "wire" | "start-sit";

export type ArticleHeroDesk = {
  kind: ArticleHeroDeskKind;
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

export function articleHeroWeekNumber(title?: string | null): string | null {
  const m = String(title ?? "").match(/\bweek\s+(\d+)\b/i);
  return m?.[1] ?? null;
}

/**
 * Desk chrome matching Broadcast demos exactly:
 * Wire → WEEK N / THE WIRE / Waiver Wire Targets (right-aligned on faded band)
 * Start/Sit → WEEK N ADVICE / START / SIT / Weekly Lineup Advice (left-aligned)
 */
export function articleHeroDeskCopy(
  category?: string | null,
  title?: string | null,
): ArticleHeroDesk | null {
  const cat = (category || "").trim().toLowerCase();
  const t = (title || "").trim().toLowerCase();
  const week = articleHeroWeekNumber(title);
  if (cat.includes("waiver") || t.includes("waiver")) {
    return {
      kind: "wire",
      weekLabel: week ? `WEEK ${week}` : null,
      title: "THE WIRE",
      subtitle: "Waiver Wire Targets",
    };
  }
  if (cat.includes("start") || t.includes("start / sit") || t.includes("start/sit")) {
    return {
      kind: "start-sit",
      weekLabel: week ? `WEEK ${week} ADVICE` : null,
      title: "START / SIT",
      subtitle: "Weekly Lineup Advice",
    };
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
          : "right-3 top-3 h-9 w-auto sm:right-4 sm:top-4 sm:h-11",
      )}
    />
  );
}

/**
 * Demo text band: solid team color flush on the far right, fades to transparent
 * toward the player (left). Never transparent on the right edge.
 */
function deskBandGradient(teamColor: string, kind: ArticleHeroDeskKind): string {
  if (kind === "wire") {
    return `linear-gradient(90deg, transparent 0%, ${teamColor}cc 28%, ${teamColor} 100%)`;
  }
  return `linear-gradient(90deg, transparent 0%, ${teamColor}aa 30%, ${teamColor} 100%)`;
}

function DeskTypeBlock({
  desk,
  teamColor,
  density,
}: {
  desk: ArticleHeroDesk;
  teamColor: string;
  density: Exclude<ArticleHeroDensity, "micro">;
}) {
  const isCompact = density === "compact";
  const rightAlign = desk.kind === "wire";

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-y-0 right-0 flex flex-col justify-center",
        isCompact ? "w-[58%]" : "w-[56%] sm:w-[54%]",
      )}
    >
      {/* Band is flush to the hero’s right edge; only text gets inner padding. */}
      <div
        className={cn(
          "w-full",
          rightAlign ? "text-right" : "text-left",
          isCompact ? "py-1 pl-2 pr-1.5" : "py-2 pl-5 pr-3 sm:py-2.5 sm:pl-6 sm:pr-4",
        )}
        style={{ background: deskBandGradient(teamColor, desk.kind) }}
      >
        {desk.weekLabel ? (
          <p
            className={cn(
              "font-bold uppercase tracking-[0.18em] text-slate-900",
              isCompact ? "text-[7px] leading-none" : "text-[10px] leading-tight sm:text-[11px]",
            )}
          >
            {desk.weekLabel}
          </p>
        ) : null}
        <p
          className={cn(
            "display-title font-black uppercase tracking-tight text-white",
            isCompact
              ? "mt-0.5 text-xs leading-[0.92] sm:text-sm"
              : "mt-0.5 text-[2.15rem] leading-[0.88] sm:text-5xl md:text-6xl",
          )}
          style={
            isCompact
              ? undefined
              : {
                  WebkitTextStroke: "1.25px rgba(15, 23, 42, 0.55)",
                  paintOrder: "stroke fill",
                  textShadow: "0 1px 2px rgba(15, 23, 42, 0.25)",
                }
          }
        >
          {desk.title}
        </p>
        <p
          className={cn(
            "font-medium tracking-wide text-white",
            isCompact
              ? "mt-0.5 truncate text-[7px] leading-tight text-white/90"
              : "mt-0.5 text-xs leading-snug sm:text-sm",
          )}
        >
          {desk.subtitle}
        </p>
      </div>
    </div>
  );
}

/**
 * Article / card / list hero.
 * Featured: team→white gradient, cutout, faded team logo, desk type on a
 * soft fading wash (demo style), white League wordmark upper-right.
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
            : `linear-gradient(100deg, ${teamColor} 0%, ${teamColor} 36%, color-mix(in srgb, ${teamColor} 28%, #f8fafc) 58%, #ffffff 100%)`,
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
            isMicro ? "w-full" : isCompact ? "w-[46%]" : "w-[48%]",
          )}
        >
          <img
            src={shot}
            alt=""
            className={cn(
              "absolute bottom-0 left-1/2 max-h-full -translate-x-1/2 object-contain object-bottom",
              isMicro ? "h-[115%] w-auto" : isCompact ? "h-[112%] w-auto" : "h-[115%] w-auto",
            )}
          />
        </div>

        {!isMicro && desk ? (
          <DeskTypeBlock desk={desk} teamColor={teamColor} density={density} />
        ) : !isMicro ? (
          <div
            className={cn(
              "pointer-events-none absolute inset-y-0 right-0 flex items-center",
              isCompact ? "w-[54%] pr-2" : "w-[52%] pr-6",
            )}
          >
            <p
              className={cn(
                "line-clamp-3 font-black uppercase leading-tight tracking-tight text-slate-900",
                isCompact ? "text-[9px]" : "text-xl sm:text-2xl md:text-3xl",
              )}
            >
              {title}
            </p>
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
