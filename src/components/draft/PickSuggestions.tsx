import { Sparkles, TrendingDown, Target, Star, Crown } from "lucide-react";
import { PositionBadge } from "./PositionBadge";
import { cn } from "@/lib/utils";
import { value, type Player, type Pos, type Settings, type SuggestionReason } from "@/lib/draft";

type Suggestion = {
  player: Player;
  reason: SuggestionReason;
  label: string;
  score: number;
};

const REASON_META: Record<
  SuggestionReason,
  { icon: React.ElementType; label: string; className: string }
> = {
  value: { icon: TrendingDown, label: "Value fall", className: "text-emerald-600 bg-emerald-100" },
  need: { icon: Target, label: "Positional need", className: "text-amber-600 bg-amber-100" },
  rank: { icon: Crown, label: "Best available", className: "text-primary bg-primary/10" },
  watch: { icon: Star, label: "Watchlist", className: "text-accent bg-accent/10" },
};

export function suggestedPicks(
  players: Player[],
  draftedIds: Set<string>,
  needs: Record<Pos, number>,
  watchIds: Set<string>,
  settings: Settings,
  currentOverall: number,
  limit = 8,
): Suggestion[] {
  const available = players.filter((p) => !draftedIds.has(p.id));
  const v = (p: Player) => value(p, settings.scoring);

  const withReasons: Suggestion[] = available.map((p) => {
    const pv = v(p);
    let reason: SuggestionReason = "rank";
    let label = "Best available";
    let score = 1000 - pv.rank;

    const adpGap = pv.adp < 900 ? currentOverall - pv.adp : -999;
    if (adpGap >= 6) {
      reason = "value";
      label = `${adpGap.toFixed(0)} picks past ADP`;
      score = 2000 + adpGap * 10 + pv.proj;
    } else if ((needs[p.pos] ?? 0) > 0) {
      reason = "need";
      label = `Need ${p.pos}`;
      score = 1500 + (needs[p.pos] ?? 0) * 100 + (1000 - pv.rank);
    }

    if (watchIds.has(p.id)) {
      reason = "watch";
      label = "On your watchlist";
      score += 300;
    }

    return { player: p, reason, label, score };
  });

  return withReasons.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function PickSuggestions({
  players,
  draftedIds,
  needs,
  watchIds,
  settings,
  currentOverall,
  onDraft,
  onOpen,
}: {
  players: Player[];
  draftedIds: Set<string>;
  needs: Record<Pos, number>;
  watchIds: Set<string>;
  settings: Settings;
  currentOverall: number;
  onDraft: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const suggestions = suggestedPicks(players, draftedIds, needs, watchIds, settings, currentOverall);

  if (!suggestions.length) {
    return (
      <p className="p-3 text-center text-xs text-muted-foreground">
        No suggestions available.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5">
      {suggestions.map(({ player, reason, label }) => {
        const pv = value(player, settings.scoring);
        const meta = REASON_META[reason];
        const Icon = meta.icon;
        return (
          <li
            key={player.id}
            className="group rounded-lg border border-border bg-card p-2 transition-colors hover:border-primary/50"
          >
            <button
              onClick={() => onOpen(player.id)}
              className="flex w-full items-center gap-2 text-left"
            >
              <PositionBadge pos={player.pos} className="h-5 text-[10px]" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {player.name}
              </span>
              <span className="tabnum text-[10px] text-muted-foreground">
                #{pv.rank}
              </span>
            </button>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                  meta.className,
                )}
              >
                <Icon className="size-3" />
                {label}
              </span>
              <button
                onClick={() => onDraft(player.id)}
                className="rounded bg-primary px-2 py-1 font-display text-[10px] uppercase tracking-wide text-primary-foreground opacity-0 transition-opacity group-hover:opacity-100"
              >
                Draft
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function PickSuggestionsEmpty() {
  return (
    <div className="flex flex-col items-center gap-2 p-4 text-center text-xs text-muted-foreground">
      <Sparkles className="size-5 text-muted-foreground/50" />
      <p>Suggestions will appear once players are ranked and your roster needs are known.</p>
    </div>
  );
}
