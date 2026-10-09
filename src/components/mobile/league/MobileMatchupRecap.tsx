import { X } from "lucide-react";
import { useMemo } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import type { WeeklyMatchupEntry } from "@/lib/league.server";
import type { Player } from "@/lib/players-build";
import { cn } from "@/lib/utils";

import { Score, shortName, type LineupRow, type MatchupViewerResult } from "./lineupShared";
import { MobileTeamLogo } from "./MobileStandings";

type SideLineup = { starters: LineupRow[]; bench: LineupRow[] };

type Battle = {
  slot: string;
  home: LineupRow | undefined;
  away: LineupRow | undefined;
  homePts: number;
  awayPts: number;
  winner: "home" | "away" | "tie";
};

type Performer = {
  side: "home" | "away";
  player: Player;
  points: number;
  projected: number | null;
  delta: number | null;
};

/**
 * Past-week matchup recap built entirely from data already on the matchup page
 * (lineups, host points, starter projections). No new network calls.
 */
export function MobileMatchupRecap({
  week,
  home,
  away,
  homeLineup,
  awayLineup,
  labels,
  homeProjected,
  awayProjected,
  pointsFor,
  projectedFor,
  viewerResult,
  homePoints: homePointsProp,
  awayPoints: awayPointsProp,
  onClose,
}: {
  week: number;
  home: WeeklyMatchupEntry;
  away: WeeklyMatchupEntry;
  homeLineup: SideLineup;
  awayLineup: SideLineup;
  labels: string[];
  homeProjected: number;
  awayProjected: number;
  pointsFor: (entry: WeeklyMatchupEntry, player: Player) => number;
  projectedFor: (player: Player) => number | null;
  /** Set when the open recap is the signed-in manager's matchup. */
  viewerResult?: MatchupViewerResult | null;
  /** Live starter-sum totals when host entry.points lags player scores. */
  homePoints?: number;
  awayPoints?: number;
  onClose: () => void;
}) {
  const homePts = homePointsProp ?? home.points;
  const awayPts = awayPointsProp ?? away.points;
  const margin = Math.round((homePts - awayPts) * 100) / 100;
  const homeWon = homePts > awayPts;
  const awayWon = awayPts > homePts;
  const tied = !homeWon && !awayWon;

  const battles = useMemo((): Battle[] => {
    return labels.map((slot, i) => {
      const h = homeLineup.starters[i];
      const a = awayLineup.starters[i];
      const homePts = h?.player ? pointsFor(home, h.player) : 0;
      const awayPts = a?.player ? pointsFor(away, a.player) : 0;
      const winner =
        Math.abs(homePts - awayPts) < 0.005 ? "tie" : homePts > awayPts ? "home" : "away";
      return { slot, home: h, away: a, homePts, awayPts, winner };
    });
  }, [labels, homeLineup.starters, awayLineup.starters, home, away, pointsFor]);

  const slotWins = useMemo(() => {
    let h = 0;
    let a = 0;
    for (const b of battles) {
      if (b.winner === "home") h += 1;
      if (b.winner === "away") a += 1;
    }
    return { home: h, away: a };
  }, [battles]);

  const performers = useMemo((): Performer[] => {
    const rows: Performer[] = [];
    const push = (side: "home" | "away", entry: WeeklyMatchupEntry, row: LineupRow | undefined) => {
      if (!row?.player) return;
      const points = pointsFor(entry, row.player);
      const projected = projectedFor(row.player);
      rows.push({
        side,
        player: row.player,
        points,
        projected,
        delta: projected != null ? Math.round((points - projected) * 100) / 100 : null,
      });
    };
    for (const row of homeLineup.starters) push("home", home, row);
    for (const row of awayLineup.starters) push("away", away, row);
    return rows;
  }, [homeLineup.starters, awayLineup.starters, home, away, pointsFor, projectedFor]);

  const topScorers = useMemo(
    () => [...performers].sort((a, b) => b.points - a.points).slice(0, 3),
    [performers],
  );
  const biggestBoom = useMemo(
    () =>
      [...performers]
        .filter((p) => p.delta != null)
        .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))[0] ?? null,
    [performers],
  );
  const biggestBust = useMemo(
    () =>
      [...performers]
        .filter((p) => p.delta != null)
        .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))[0] ?? null,
    [performers],
  );

  const benchLeft = useMemo(() => {
    const sum = (entry: WeeklyMatchupEntry, rows: LineupRow[]) =>
      rows.reduce((acc, row) => (row.player ? acc + pointsFor(entry, row.player) : acc), 0);
    return {
      home: Math.round(sum(home, homeLineup.bench) * 100) / 100,
      away: Math.round(sum(away, awayLineup.bench) * 100) / 100,
    };
  }, [home, away, homeLineup.bench, awayLineup.bench, pointsFor]);

  const homeDelta = Math.round((homePts - homeProjected) * 100) / 100;
  const awayDelta = Math.round((awayPts - awayProjected) * 100) / 100;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/50" role="dialog" aria-modal="true" aria-label="Matchup recap">
      <button type="button" className="min-h-[12vh] flex-1" aria-label="Close recap" onClick={onClose} />
      <div className="max-h-[88vh] overflow-y-auto rounded-t-2xl bg-m-bg text-m-card-fg shadow-[0_-8px_24px_rgba(0,0,0,0.25)]">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-m-border bg-m-card px-4 py-3">
          <div>
            <p className="font-display text-lg font-bold">Week {week} Recap</p>
            <p className="text-xs text-m-muted">
              {tied ? "Tie game" : homeWon ? `${home.teamName} wins` : `${away.teamName} wins`}
              {!tied ? ` by ${Math.abs(margin).toFixed(2)}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-10 items-center justify-center rounded-full bg-m-icon-bg text-m-icon-fg"
          >
            <X className="size-5" strokeWidth={2.5} />
          </button>
        </div>

        <div className="space-y-4 px-3 py-4">
          {viewerResult === "won" || viewerResult === "lost" || viewerResult === "tied" ? (
            <section className="rounded-xl bg-m-card px-4 py-3.5 text-center shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
              <p
                className={cn(
                  "font-display text-2xl font-extrabold italic tracking-wide",
                  viewerResult === "won" && "text-emerald-500",
                  viewerResult === "lost" && "text-red-500",
                  viewerResult === "tied" && "text-m-muted",
                )}
              >
                {viewerResult === "won" ? "You Won" : viewerResult === "lost" ? "You Lost" : "You Tied"}
              </p>
            </section>
          ) : null}

          <section className="rounded-xl bg-m-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div className="min-w-0 text-center">
                <MobileTeamLogo name={home.teamName} logo={home.logo} className="mx-auto size-12" />
                <p className="mt-2 truncate text-sm font-semibold">{home.teamName}</p>
                <Score
                  value={homePts}
                  className={cn(
                    "mt-1 font-display text-2xl font-extrabold italic",
                    homeWon && "text-emerald-500",
                  )}
                />
              </div>
              <span className="font-display text-xs font-bold text-m-muted">VS</span>
              <div className="min-w-0 text-center">
                <MobileTeamLogo name={away.teamName} logo={away.logo} className="mx-auto size-12" />
                <p className="mt-2 truncate text-sm font-semibold">{away.teamName}</p>
                <Score
                  value={awayPts}
                  className={cn(
                    "mt-1 font-display text-2xl font-extrabold italic",
                    awayWon && "text-emerald-500",
                  )}
                />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs">
              <p className="rounded-lg bg-m-row-alt px-2 py-2 text-m-muted">
                Slot battles{" "}
                <span className="font-bold text-m-card-fg">
                  {slotWins.home}-{slotWins.away}
                </span>
              </p>
              <p className="rounded-lg bg-m-row-alt px-2 py-2 text-m-muted">
                vs proj{" "}
                <span className="font-bold text-m-card-fg">
                  {homeDelta >= 0 ? "+" : ""}
                  {homeDelta.toFixed(1)} / {awayDelta >= 0 ? "+" : ""}
                  {awayDelta.toFixed(1)}
                </span>
              </p>
            </div>
          </section>

          <section>
            <h3 className="px-1 pb-2 font-display text-sm font-bold uppercase tracking-[0.08em] text-m-section">
              Top Scorers
            </h3>
            <div className="space-y-2">
              {topScorers.map((row, i) => (
                <div
                  key={`${row.side}-${row.player.id}`}
                  className="flex items-center gap-3 rounded-xl bg-m-card px-3 py-2.5"
                >
                  <span className="w-5 text-center font-display text-sm font-bold text-m-muted">{i + 1}</span>
                  <PlayerAvatar
                    id={row.player.id}
                    pos={row.player.pos}
                    team={row.player.team}
                    name={row.player.name}
                    className="size-10"
                    logoClassName="hidden"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{shortName(row.player)}</p>
                    <p className="truncate text-[11px] text-m-muted">
                      {row.side === "home" ? home.teamName : away.teamName} · {row.player.pos}
                    </p>
                  </div>
                  <Score value={row.points} className="font-display text-lg font-bold italic" />
                </div>
              ))}
            </div>
          </section>

          {(biggestBoom || biggestBust) && (
            <section className="grid grid-cols-2 gap-2">
              {biggestBoom ? (
                <StoryChip
                  label="Biggest boom"
                  name={shortName(biggestBoom.player)}
                  value={biggestBoom.delta!}
                  positive
                />
              ) : null}
              {biggestBust ? (
                <StoryChip
                  label="Biggest bust"
                  name={shortName(biggestBust.player)}
                  value={biggestBust.delta!}
                  positive={false}
                />
              ) : null}
            </section>
          )}

          <section>
            <h3 className="px-1 pb-2 font-display text-sm font-bold uppercase tracking-[0.08em] text-m-section">
              Position Battles
            </h3>
            <div className="overflow-hidden rounded-xl bg-m-card">
              {battles.map((b, i) => (
                <div
                  key={`${b.slot}-${i}`}
                  className={cn(
                    "grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2.5 text-sm",
                    i > 0 && "border-t border-m-border",
                  )}
                >
                  <BattleSide row={b.home} points={b.homePts} won={b.winner === "home"} align="left" />
                  <span className="text-[10px] font-bold uppercase text-m-muted">{b.slot}</span>
                  <BattleSide row={b.away} points={b.awayPts} won={b.winner === "away"} align="right" />
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl bg-m-card p-4">
            <h3 className="font-display text-sm font-bold uppercase tracking-[0.08em] text-m-section">
              Bench Points
            </h3>
            <p className="mt-1 text-xs text-m-muted">Points left on the bench this week.</p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-center">
              <div>
                <p className="truncate text-xs text-m-muted">{home.teamName}</p>
                <Score value={benchLeft.home} className="mt-1 font-display text-xl font-bold italic" />
              </div>
              <div>
                <p className="truncate text-xs text-m-muted">{away.teamName}</p>
                <Score value={benchLeft.away} className="mt-1 font-display text-xl font-bold italic" />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function StoryChip({
  label,
  name,
  value,
  positive,
}: {
  label: string;
  name: string;
  value: number;
  positive: boolean;
}) {
  return (
    <div className="rounded-xl bg-m-card px-3 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-m-muted">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold">{name}</p>
      <p
        className={cn(
          "mt-1 font-display text-lg font-bold italic tabnum",
          positive ? "text-emerald-500" : "text-red-500",
        )}
      >
        {value >= 0 ? "+" : ""}
        {value.toFixed(1)}
      </p>
    </div>
  );
}

function BattleSide({
  row,
  points,
  won,
  align,
}: {
  row: LineupRow | undefined;
  points: number;
  won: boolean;
  align: "left" | "right";
}) {
  const name = row?.player ? shortName(row.player) : row?.name || "—";
  return (
    <div className={cn("min-w-0", align === "right" && "text-right")}>
      <p className={cn("truncate text-[13px] font-semibold", won && "text-emerald-500")}>{name}</p>
      <p className={cn("text-xs tabnum", won ? "font-bold text-m-card-fg" : "text-m-muted")}>
        {points.toFixed(2)}
      </p>
    </div>
  );
}
