import { X } from "lucide-react";

import { PositionBadge } from "./PositionBadge";
import { fillRoster, teamName, value, type Pick, type Player, type Settings } from "@/lib/draft";

export function RosterPanel({
  settings,
  picks,
  byId,
  team,
  onRemove,
}: {
  settings: Settings;
  picks: Pick[];
  byId: Map<string, Player>;
  team: number;
  onRemove?: (playerId: string) => void;
}) {
  const roster = picks
    .filter((p) => p.team === team)
    .map((p) => byId.get(p.playerId))
    .filter((p): p is Player => Boolean(p));

  const slots = fillRoster(roster, settings.roster);
  const projected = roster.reduce((sum, p) => sum + value(p, settings.scoring).proj, 0);

  return (
    <div className="no-scrollbar h-full overflow-y-auto pb-3">
      <div className="p-3">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="display-title text-xl">{teamName(settings, team)}</h2>
        <span className="tabnum text-sm text-muted-foreground">
          {roster.length} picks · {projected.toFixed(0)} proj pts
        </span>
      </div>
      <ul className="space-y-1">
        {slots.map((s, i) => (
          <li
            key={i}
            className="flex items-center gap-3 rounded border border-border bg-card px-2.5 py-2"
          >
            <span className="w-10 shrink-0 font-display text-xs uppercase tracking-wider text-muted-foreground">
              {s.slot}
            </span>
            {s.player ? (
              <>
                <PositionBadge pos={s.player.pos} className="h-5 text-[10px]" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {s.player.name}
                </span>
                <span className="tabnum text-xs text-muted-foreground">
                  {value(s.player, settings.scoring).proj.toFixed(1)}
                </span>
                {onRemove && (
                  <button
                    aria-label={`Remove ${s.player.name}`}
                    onClick={() => onRemove(s.player!.id)}
                    className="rounded border border-border p-1 text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </>
            ) : (
              <span className="text-sm text-muted-foreground">Empty</span>
            )}
          </li>
        ))}
      </ul>
      </div>
    </div>
  );
}
