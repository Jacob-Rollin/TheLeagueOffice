import { PositionBadge } from "./PositionBadge";
import { cn } from "@/lib/utils";
import { value, type Player, type Pos, type Settings } from "@/lib/draft";

type Scored = { player: Player; score: number; reason: string };

/** Rank the best available players for the user's team: value falls + roster needs. */
export function suggest(
  players: Player[],
  draftedIds: Set<string>,
  needs: Record<Pos, number>,
  settings: Settings,
  currentOverall: number,
  limit = 8,
): Scored[] {
  const pool = players.filter((p) => !draftedIds.has(p.id));
  return pool
    .map((p) => {
      const v = value(p, settings.scoring);
      const rank = v.rank > 900 ? 400 : v.rank;
      const fall = v.adp < 900 ? currentOverall - v.adp : 0;
      const need = needs[p.pos] ?? 0;
      const score = -rank + Math.max(0, fall) * 2.5 + Math.min(need, 3) * 12;
      const reason =
        fall >= 8
          ? `Value fall · ADP ${v.adp.toFixed(0)}`
          : need > 0
            ? `Fills ${p.pos} need`
            : `Best available · #${rank}`;
      return { player: p, score, reason };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function DraftSuggestions({
  players,
  draftedIds,
  needs,
  settings,
  currentOverall,
  onDraft,
  onOpen,
}: {
  players: Player[];
  draftedIds: Set<string>;
  needs: Record<Pos, number>;
  settings: Settings;
  currentOverall: number;
  onDraft: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const list = suggest(players, draftedIds, needs, settings, currentOverall);

  if (!list.length)
    return <p className="p-3 text-center text-xs text-muted-foreground">No players available.</p>;

  return (
    <ul className="space-y-1">
      {list.map(({ player, reason }, i) => (
        <li
          key={player.id}
          className={cn(
            "rounded border border-border bg-background px-2 py-1.5",
            i === 0 && "border-primary",
          )}
        >
          <button
            onClick={() => onOpen(player.id)}
            className="flex w-full items-center gap-2 text-left"
          >
            <PositionBadge pos={player.pos} className="h-5 text-[10px]" />
            <span className="min-w-0 flex-1 truncate text-xs font-semibold">{player.name}</span>
            <span className="tabnum text-[10px] text-muted-foreground">
              {value(player, settings.scoring).proj.toFixed(0)}
            </span>
          </button>
          <div className="mt-1 flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
              {reason}
            </span>
            <button
              onClick={() => onDraft(player.id)}
              className="rounded bg-primary px-2 py-1 font-display text-[10px] uppercase text-primary-foreground"
            >
              Draft
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
