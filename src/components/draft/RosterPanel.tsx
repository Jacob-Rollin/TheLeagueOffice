import { PositionBadge } from "./PositionBadge";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { injuryMicroBadge, resolveInjuryStatus } from "@/lib/sandbox-rosters";
import { cn } from "@/lib/utils";
import {
  fillRoster,
  posDisplayLabel,
  teamName,
  value,
  type Pick,
  type Player,
  type Settings,
} from "@/lib/draft";

export function RosterPanel({
  settings,
  picks,
  byId,
  team,
}: {
  settings: Settings;
  picks: Pick[];
  byId: Map<string, Player>;
  team: number;
}) {
  const roster = picks
    .filter((p) => p.team === team)
    .map((p) => byId.get(p.playerId))
    .filter((p): p is Player => Boolean(p));
  const brain = usePlayerBrain();

  const slots = fillRoster(roster, settings.roster);
  const projected = roster.reduce((sum, p) => sum + value(p, settings.scoring).proj, 0);

  return (
    <div className="pb-3">
      <div className="p-3">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="display-title text-xl text-slate-900">{teamName(settings, team)}</h2>
          <span className="tabnum text-sm text-slate-500">
            {roster.length} picks · {projected.toFixed(0)} proj pts
          </span>
        </div>
        <ul className="space-y-1">
          {slots.map((s, i) => (
            <li
              key={i}
              className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-2.5 py-2"
            >
              <span className="w-10 shrink-0 font-display text-xs uppercase tracking-wider text-slate-500">
                {posDisplayLabel(s.slot)}
              </span>
              {s.player ? (
                <>
                  <PositionBadge pos={s.player.pos} className="h-5 text-[10px]" />
                  <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                    <span className="truncate text-sm font-semibold text-slate-900">
                      {s.player.name}
                    </span>
                    {(() => {
                      const badge = injuryMicroBadge(resolveInjuryStatus(s.player, brain));
                      return badge ? (
                        <span
                          className={cn(
                            "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[2px] px-1 text-[10px] font-bold leading-none text-white",
                            badge.className,
                          )}
                        >
                          {badge.label}
                        </span>
                      ) : null;
                    })()}
                  </span>
                  <span className="tabnum text-xs text-slate-500">
                    {value(s.player, settings.scoring).proj.toFixed(1)}
                  </span>
                </>
              ) : (
                <span className="text-sm text-slate-400">Empty</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
