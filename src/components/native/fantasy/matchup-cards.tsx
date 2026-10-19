import type { ReactNode } from "react";

import { FantasyBoard } from "@/components/native/fantasy/chrome";
import { formatFantasyProj, formatFantasyPts } from "@/components/native/fantasy/format";
import { cn } from "@/lib/utils";

export type FantasyMatchupTeamSide = {
  teamId: number;
  teamName: string;
  points: number;
  projection?: number | null | undefined;
  wins?: number | undefined;
  losses?: number | undefined;
  ties?: number | undefined;
};

export type FantasyMatchupCard = {
  matchupId: number;
  home: FantasyMatchupTeamSide;
  away: FantasyMatchupTeamSide;
};

type MatchupStatusBadge = "live" | "final" | null;

function formatRecord(wins?: number, losses?: number, ties?: number) {
  if (wins == null && losses == null) return null;
  const w = wins ?? 0;
  const l = losses ?? 0;
  const t = ties ?? 0;
  return `${w}-${l}${t > 0 ? `-${t}` : ""}`;
}

function StatusBadge({ status }: { status?: MatchupStatusBadge | undefined }) {
  if (!status) return null;
  const live = status === "live";
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
        live ? "bg-accent/15 text-accent" : "bg-slate-100 text-slate-600",
      )}
    >
      {live ? "Live" : "Final"}
    </span>
  );
}

type FantasyMatchupScoreCardProps = {
  home: FantasyMatchupTeamSide;
  away: FantasyMatchupTeamSide;
  myTeamId?: number | null;
  weekLabel?: ReactNode;
  status?: MatchupStatusBadge;
  className?: string;
};

export function FantasyMatchupScoreCard({
  home,
  away,
  myTeamId,
  weekLabel,
  status,
  className,
}: FantasyMatchupScoreCardProps) {
  const homeMine = myTeamId != null && home.teamId === myTeamId;
  const awayMine = myTeamId != null && away.teamId === myTeamId;

  return (
    <section
      className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm", className)}
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <TeamScoreBlock team={home} mine={homeMine} align="left" />
        <div className="flex flex-col items-center gap-1 text-center">
          {weekLabel ?? (
            <span className="font-display text-xs font-bold uppercase tracking-widest text-slate-500">
              VS
            </span>
          )}
          <StatusBadge status={status} />
        </div>
        <TeamScoreBlock team={away} mine={awayMine} align="right" />
      </div>
    </section>
  );
}

function TeamScoreBlock({
  team,
  mine,
  align,
}: {
  team: FantasyMatchupTeamSide;
  mine: boolean;
  align: "left" | "right";
}) {
  const record = formatRecord(team.wins, team.losses, team.ties);

  return (
    <div className={cn(align === "right" && "sm:text-right")}>
      <p className={cn("truncate font-medium text-slate-900", mine && "text-primary")}>
        {team.teamName}
      </p>
      {record ? (
        <p className="text-xs text-muted-foreground">{record}</p>
      ) : null}
      <p className="mt-1 font-display text-3xl font-semibold italic tracking-wide text-slate-900">
        {formatFantasyPts(team.points)}
      </p>
      {team.projection != null && Number.isFinite(team.projection) ? (
        <p className="text-xs text-muted-foreground">
          Proj {formatFantasyProj(team.projection)}
        </p>
      ) : null}
    </div>
  );
}

type FantasyMatchupWeekListProps = {
  matchups: FantasyMatchupCard[];
  myTeamId?: number | null;
  selectedMatchupId?: number | null;
  onSelectMatchup?: (matchupId: number) => void;
  title?: string;
  className?: string;
};

export function FantasyMatchupWeekList({
  matchups,
  myTeamId,
  selectedMatchupId,
  onSelectMatchup,
  title = "All matchups",
  className,
}: FantasyMatchupWeekListProps) {
  if (!matchups.length) return null;

  return (
    <FantasyBoard
      className={className}
      title={title}
      bodyClassName="divide-y divide-slate-100"
    >
      <ul>
        {matchups.map((m) => {
          const mine =
            myTeamId != null && (m.home.teamId === myTeamId || m.away.teamId === myTeamId);
          const selected = selectedMatchupId != null && m.matchupId === selectedMatchupId;
          const interactive = onSelectMatchup != null;

          const row = (
            <>
              <span className="min-w-0 truncate text-left">
                <span className={cn(m.home.teamId === myTeamId && "font-semibold text-primary")}>
                  {m.home.teamName}
                </span>
                <span className="ml-1.5 font-display italic tabular-nums text-slate-900">
                  {formatFantasyPts(m.home.points)}
                </span>
              </span>
              <span className="flex w-8 shrink-0 items-center justify-center text-[10px] font-bold uppercase tracking-wide text-slate-400">
                vs
              </span>
              <span className="min-w-0 truncate text-right">
                <span className="font-display italic tabular-nums text-slate-900">
                  {formatFantasyPts(m.away.points)}
                </span>
                <span className="ml-1.5" />
                <span className={cn(m.away.teamId === myTeamId && "font-semibold text-primary")}>
                  {m.away.teamName}
                </span>
              </span>
            </>
          );

          const rowClass = cn(
            "grid w-full grid-cols-[1fr_auto_1fr] items-center gap-1 px-4 py-2.5 text-sm text-slate-800",
            mine && "bg-primary/5",
            selected && "ring-1 ring-inset ring-primary/30",
            interactive && "cursor-pointer hover:bg-slate-50",
          );

          if (interactive) {
            return (
              <li key={m.matchupId}>
                <button type="button" className={rowClass} onClick={() => onSelectMatchup(m.matchupId)}>
                  {row}
                </button>
              </li>
            );
          }

          return (
            <li key={m.matchupId} className={rowClass}>
              {row}
            </li>
          );
        })}
      </ul>
    </FantasyBoard>
  );
}

/** Map native `getNativeMatchupWeek` matchup rows into card/list props (scores only). */
export function nativeMatchupViewToCard(
  m: {
    matchupId: number;
    home: { teamId: number; teamName: string; points: number };
    away: { teamId: number; teamName: string; points: number };
  },
): FantasyMatchupCard {
  return {
    matchupId: m.matchupId,
    home: { ...m.home },
    away: { ...m.away },
  };
}
