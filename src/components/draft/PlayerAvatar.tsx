import { cn } from "@/lib/utils";
import type { Pos } from "@/lib/draft";

export function playerImage(id: string, pos: Pos, team: string): string {
  if (pos === "DEF") return teamLogo(team || id) ?? "";
  return `https://sleepercdn.com/content/nfl/players/${id}.jpg`;
}

export function teamLogo(team: string | null | undefined) {
  if (!team) return null;
  return `https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.png`;
}

/** Sleeper-style headshot with the team logo tucked in the corner. */
export function PlayerAvatar({
  id,
  pos,
  team,
  name,
  className,
  logoClassName,
}: {
  id: string;
  pos: Pos;
  team: string;
  name: string;
  className?: string;
  logoClassName?: string;
}) {
  const logo = teamLogo(team);
  return (
    <div className={cn("relative size-16 shrink-0", className)}>
      <div className="size-full overflow-hidden rounded-full border border-border bg-surface">
        <img
          src={playerImage(id, pos, team)}
          alt={name}
          loading="lazy"
          className="size-full object-cover object-top"
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
        />
      </div>
      {logo && (
        <img
          src={logo}
          alt={`${team} logo`}
          loading="lazy"
          className={cn(
            "absolute -bottom-1 -right-1 size-6 rounded-full border border-border bg-background p-0.5",
            logoClassName,
          )}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
    </div>
  );
}
