import { PositionBadge } from "./PositionBadge";
import { cn } from "@/lib/utils";
import { teamForPick, teamName, type Pick, type Player, type Settings } from "@/lib/draft";

export function DraftBoard({
  settings,
  picks,
  byId,
}: {
  settings: Settings;
  picks: Pick[];
  byId: Map<string, Player>;
}) {
  const pickByOverall = new Map(picks.map((p) => [p.overall, p]));

  return (
    <div className="w-full p-3">
      <div
        className="grid w-full gap-1"
        style={{ gridTemplateColumns: `1.6rem repeat(${settings.teams}, minmax(0, 1fr))` }}
      >
        <div />
        {Array.from({ length: settings.teams }, (_, i) => i + 1).map((t) => (
          <div
            key={t}
            className={cn(
              "min-w-0 rounded px-1 py-1 text-center font-display text-xs font-semibold uppercase tracking-wide",
              t === settings.myTeam ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            <span className="block truncate">{teamName(settings, t)}</span>
          </div>
        ))}

        {Array.from({ length: settings.rounds }, (_, r) => r + 1).map((round) => (
          <RoundRow
            key={round}
            round={round}
            settings={settings}
            pickByOverall={pickByOverall}
            byId={byId}
          />
        ))}
      </div>
    </div>
  );
}

function RoundRow({
  round,
  settings,
  pickByOverall,
  byId,
}: {
  round: number;
  settings: Settings;
  pickByOverall: Map<number, Pick>;
  byId: Map<string, Player>;
}) {
  const cells = Array.from({ length: settings.teams }, (_, i) => {
    const team = i + 1;
    const overall = Array.from(
      { length: settings.teams },
      (_, k) => (round - 1) * settings.teams + k + 1,
    ).find((o) => teamForPick(o, settings.teams, settings.snake) === team)!;
    return { team, overall, pick: pickByOverall.get(overall) };
  });

  return (
    <>
      <div className="tabnum flex items-center justify-center font-display text-sm text-muted-foreground">
        {round}
      </div>
      {cells.map(({ team, overall, pick }) => {
        const player = pick ? byId.get(pick.playerId) : undefined;
        return (
          <div
            key={team}
            className={cn(
              "h-14 min-w-0 rounded border p-1 sm:p-1.5",
              player ? "border-border bg-card" : "border-dashed border-border/60 bg-surface/40",
            )}
          >
            {player ? (
              <div className="flex h-full flex-col justify-between">
                <span className="truncate text-[11px] font-semibold leading-tight">{player.name}</span>
                <div className="flex items-center justify-between gap-1">
                  <PositionBadge pos={player.pos} className="h-4 min-w-0 px-1 text-[10px]" />
                  <span className="tabnum text-[10px] text-muted-foreground">{player.team}</span>
                </div>
              </div>
            ) : (
              <span className="tabnum text-[10px] text-muted-foreground">#{overall}</span>
            )}
          </div>
        );
      })}
    </>
  );
}
