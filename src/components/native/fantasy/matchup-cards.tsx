import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { FantasyBoard } from "@/components/native/fantasy/chrome";
import { formatFantasyProj, formatFantasyPts } from "@/components/native/fantasy/format";
import { MatchupTeamAvatar } from "@/components/playbook/MatchupPreviewCard";
import { cn } from "@/lib/utils";

export type FantasyMatchupTeamSide = {
  teamId: number;
  teamName: string;
  points: number;
  projection?: number | null | undefined;
  wins?: number | undefined;
  losses?: number | undefined;
  ties?: number | undefined;
  avatarUrl?: string | null | undefined;
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
  /** When set, wraps the card (no outer border) for embedding in a FantasyBoard. */
  embedded?: boolean;
  cacheKey?: string;
};

export function FantasyMatchupScoreCard({
  home,
  away,
  myTeamId,
  weekLabel,
  status,
  className,
  embedded = false,
  cacheKey = "native-matchup",
}: FantasyMatchupScoreCardProps) {
  const homeMine = myTeamId != null && home.teamId === myTeamId;
  const awayMine = myTeamId != null && away.teamId === myTeamId;

  return (
    <section
      className={cn(
        embedded ? "p-1" : "rounded-xl border border-slate-200 bg-white p-5 shadow-sm",
        className,
      )}
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <TeamScoreBlock team={home} mine={homeMine} align="left" cacheKey={cacheKey} />
        <div className="flex flex-col items-center gap-1 text-center">
          {weekLabel ?? (
            <span className="font-display text-xs font-bold uppercase tracking-widest text-slate-500">
              VS
            </span>
          )}
          <StatusBadge status={status} />
        </div>
        <TeamScoreBlock team={away} mine={awayMine} align="right" cacheKey={cacheKey} />
      </div>
    </section>
  );
}

function TeamScoreBlock({
  team,
  mine,
  align,
  cacheKey,
}: {
  team: FantasyMatchupTeamSide;
  mine: boolean;
  align: "left" | "right";
  cacheKey: string;
}) {
  const record = formatRecord(team.wins, team.losses, team.ties);
  const mirrored = align === "right";

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3",
        mirrored && "sm:flex-row-reverse sm:text-right",
      )}
    >
      <MatchupTeamAvatar
        name={team.teamName}
        logo={team.avatarUrl}
        platform="native"
        cacheKey={`${cacheKey}-${team.teamId}`}
      />
      <div className="min-w-0 flex-1">
        <p className={cn("truncate font-medium text-slate-900", mine && "text-primary")}>
          {team.teamName}
        </p>
        {record ? <p className="text-xs text-muted-foreground">{record}</p> : null}
        <p className="mt-1 font-display text-3xl font-semibold italic tracking-wide text-slate-900">
          {formatFantasyPts(team.points)}
        </p>
        {team.projection != null && Number.isFinite(team.projection) ? (
          <p className="text-xs text-muted-foreground">
            Proj {formatFantasyProj(team.projection)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Compact “Around the League” rows — Playbook-style, logos + scores. */
export function FantasyAroundLeagueList({
  matchups,
  myTeamId,
  linkId,
  cacheKey = "around",
  className,
}: {
  matchups: FantasyMatchupCard[];
  myTeamId?: number | null;
  linkId: string;
  cacheKey?: string;
  className?: string;
}) {
  if (!matchups.length) return null;

  return (
    <div className={cn("mt-5 border-t border-slate-200 pt-4", className)}>
      <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
        Around the League
      </span>
      <ul className="mt-2 divide-y divide-slate-100">
        {matchups.map((m) => {
          const mine =
            myTeamId != null && (m.home.teamId === myTeamId || m.away.teamId === myTeamId);
          return (
            <li key={m.matchupId}>
              <Link
                to="/league/$linkId/matchup"
                params={{ linkId }}
                className={cn(
                  "flex items-center gap-2 px-1 py-3 transition-opacity hover:opacity-85",
                  mine && "rounded-md bg-blue-50/80",
                )}
              >
                <AroundSide team={m.home} myTeamId={myTeamId} cacheKey={cacheKey} align="left" />
                <span className="flex w-8 shrink-0 items-center justify-center text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  vs
                </span>
                <AroundSide team={m.away} myTeamId={myTeamId} cacheKey={cacheKey} align="right" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AroundSide({
  team,
  myTeamId,
  cacheKey,
  align,
}: {
  team: FantasyMatchupTeamSide;
  myTeamId?: number | null;
  cacheKey: string;
  align: "left" | "right";
}) {
  const mine = myTeamId != null && team.teamId === myTeamId;
  const mirrored = align === "right";
  const record = formatRecord(team.wins, team.losses, team.ties);
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2",
        mirrored && "flex-row-reverse text-right",
      )}
    >
      <MatchupTeamAvatar
        name={team.teamName}
        logo={team.avatarUrl}
        platform="native"
        cacheKey={`${cacheKey}-${team.teamId}`}
        size="sm"
      />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm font-semibold leading-tight text-slate-900",
            mine && "text-primary",
          )}
        >
          {team.teamName}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium tabular-nums text-slate-400">
          {record ? <span>{record}</span> : null}
          <span className="font-display text-sm font-semibold italic text-slate-900">
            {formatFantasyPts(team.points)}
          </span>
        </span>
      </span>
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
  avatars?: Map<number, string | null> | Record<number, string | null>,
  records?: Map<number, { wins: number; losses: number; ties: number }>,
): FantasyMatchupCard {
  const avatarFor = (teamId: number) => {
    if (!avatars) return null;
    if (avatars instanceof Map) return avatars.get(teamId) ?? null;
    return avatars[teamId] ?? null;
  };
  const withMeta = (side: { teamId: number; teamName: string; points: number }) => {
    const rec = records?.get(side.teamId);
    return {
      ...side,
      avatarUrl: avatarFor(side.teamId),
      ...(rec ? { wins: rec.wins, losses: rec.losses, ties: rec.ties } : {}),
    };
  };
  return {
    matchupId: m.matchupId,
    home: withMeta(m.home),
    away: withMeta(m.away),
  };
}
