import { useMemo } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { fillRoster, roundOf, type Pick as DraftPick, type Player, type Settings } from "@/lib/draft";

/** Sticky sidebar shell used by the War Room and Mock Draft workspaces. */
export function SideCard({
  title,
  subtitle,
  children,
  fit,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Fill the parent height exactly and never scroll internally. */
  fit?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card",
        fit ? "h-full" : "max-h-full",
      )}
    >
      <div className="shrink-0 border-b border-border px-3 py-1.5">
        <div className="font-display text-sm uppercase tracking-widest">{title}</div>
        {subtitle && <div className="text-[11px] text-muted-foreground">{subtitle}</div>}
      </div>
      <div className={cn("min-h-0 flex-1 p-2", fit ? "overflow-hidden" : "no-scrollbar overflow-y-auto")}>
        {children}
      </div>
    </div>
  );
}

/** Slot-by-slot roster tracker shared across draft workspaces. */
export function MyTeamColumn({
  settings,
  players,
  picks,
  onOpen,
  showProj,
  showHeader,
}: {
  settings: Settings;
  players: Player[];
  picks: DraftPick[];
  onOpen: (id: string) => void;
  showProj?: boolean;
  showHeader?: boolean;
}) {
  const slots = fillRoster(players, settings.roster);
  const pickByPlayer = useMemo(
    () =>
      picks.reduce<Record<string, DraftPick>>((acc, p) => {
        acc[p.playerId] = p;
        return acc;
      }, {}),
    [picks],
  );

  const nameSize = fit ? "clamp(0.62rem, 1.35vh, 0.75rem)" : undefined;
  const metaSize = fit ? "clamp(0.55rem, 1.1vh, 0.625rem)" : undefined;
  const avatarSize = fit ? "clamp(1.4rem, 3.4vh, 2.25rem)" : undefined;

  return (
    <div className={cn("flex min-h-0 flex-col", fit && "h-full")}>
      {showHeader && (
        <div className="mb-1 flex shrink-0 items-center gap-2 border-b border-border px-2 pb-1.5 font-display text-[10px] uppercase tracking-widest text-muted-foreground">
          <span className="w-7 shrink-0">Pos</span>
          <span className="w-9 shrink-0" />
          <span className="min-w-0 flex-1">Player</span>
          <span className="w-16 shrink-0 whitespace-nowrap text-right">2026 Proj Pts</span>
        </div>
      )}
      <ul
        className={cn(
          fit ? "flex min-h-0 flex-1 flex-col gap-[2px]" : "space-y-1",
        )}
      >
        {slots.map((s, i) => (
          <li key={i} className={cn("flex items-center gap-1", fit && "min-h-0 flex-1")}>
            {s.player ? (
              <button
                onClick={() => onOpen(s.player!.id)}
                className={cn(
                  "flex w-full items-center gap-2 overflow-hidden rounded border border-border bg-background px-2 text-left hover:border-primary",
                  fit ? "h-full py-0.5" : "py-1.5",
                )}
              >
                <span className="w-7 shrink-0 font-display text-[10px] uppercase text-muted-foreground">
                  {s.slot}
                </span>
                <PlayerAvatar
                  id={s.player.id}
                  pos={s.player.pos}
                  team={s.player.team}
                  name={s.player.name}
                  className={cn("-ml-1", !fit && "size-9")}
                  logoClassName={cn(fit ? "size-[45%] -bottom-0.5 -right-0.5" : "size-3.5")}
                  style={fit ? { width: avatarSize, height: avatarSize } : undefined}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold" style={{ fontSize: nameSize }}>
                    {s.player.name}
                  </div>
                  <div
                    className="flex items-center gap-1 truncate text-[10px] text-muted-foreground"
                    style={{ fontSize: metaSize }}
                  >
                    <span
                      className="inline-block size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: `var(--pos-${s.player.pos.toLowerCase()})` }}
                    />
                    <span>{s.player.pos}</span>
                    {s.player.team ? <span>· {s.player.team}</span> : null}
                    {s.player.bye ? <span>· BYE {s.player.bye}</span> : null}
                  </div>
                </div>
                {showProj ? (
                  <span
                    className="tabnum w-14 shrink-0 text-right text-[11px] font-semibold text-foreground"
                    style={{ fontSize: metaSize }}
                  >
                    {(s.player.proj[settings.scoring] ?? 0).toFixed(1)}
                  </span>
                ) : pickByPlayer[s.player.id] ? (
                  <span
                    className="tabnum w-10 shrink-0 text-right text-[10px] font-semibold text-muted-foreground"
                    style={{ fontSize: metaSize }}
                  >
                    {(() => {
                      const overall = pickByPlayer[s.player.id]!.overall;
                      const round = roundOf(overall, settings.teams);
                      const pick = ((overall - 1) % settings.teams) + 1;
                      return `${round}.${pick.toString().padStart(2, "0")}`;
                    })()}
                  </span>
                ) : null}
              </button>
            ) : (
              <div
                className={cn(
                  "flex flex-1 items-center gap-2 rounded border border-dashed border-border px-2",
                  fit ? "h-full py-0.5" : "py-1.5",
                )}
              >
                <span className="w-8 shrink-0 font-display text-[10px] uppercase text-muted-foreground">
                  {s.slot}
                </span>
                <span className="text-xs text-muted-foreground" style={{ fontSize: metaSize }}>
                  Empty
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
