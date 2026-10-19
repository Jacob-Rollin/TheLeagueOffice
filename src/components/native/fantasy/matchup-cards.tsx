import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { FantasyBoard } from "@/components/native/fantasy/chrome";
import { formatFantasyPts } from "@/components/native/fantasy/format";
import {
  AroundLeagueMatchupRow,
  MatchupPreviewCard,
  type AroundLeagueSide,
} from "@/components/playbook/MatchupPreviewCard";
import { winPctFromDisplayProjections } from "@/lib/rolling-live-projection";
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
  winPct?: number | undefined;
};

export type FantasyMatchupCard = {
  matchupId: number;
  home: FantasyMatchupTeamSide;
  away: FantasyMatchupTeamSide;
  weekStarted?: boolean;
  matchupFinal?: boolean;
};

function formatRecord(wins?: number, losses?: number, ties?: number) {
  if (wins == null && losses == null) return null;
  const w = wins ?? 0;
  const l = losses ?? 0;
  const t = ties ?? 0;
  return `${w}-${l}${t > 0 ? `-${t}` : ""}`;
}

function sideProj(team: FantasyMatchupTeamSide): number {
  if (team.projection != null && Number.isFinite(team.projection)) return team.projection;
  return team.points;
}

function sideWinPct(left: FantasyMatchupTeamSide, right: FantasyMatchupTeamSide): number {
  if (left.winPct != null && Number.isFinite(left.winPct)) {
    return Math.max(1, Math.min(99, Math.round(left.winPct)));
  }
  return winPctFromDisplayProjections(sideProj(left), sideProj(right));
}

type FantasyMatchupScoreCardProps = {
  home: FantasyMatchupTeamSide;
  away: FantasyMatchupTeamSide;
  myTeamId?: number | null;
  /** Kept for API compat — score card uses Playbook VS layout instead. */
  weekLabel?: ReactNode;
  status?: "live" | "final" | null;
  className?: string;
  embedded?: boolean;
  cacheKey?: string;
  weekStarted?: boolean;
  matchupFinal?: boolean;
  linkId?: string;
};

/**
 * Native dashboard hero matchup — same layout as Playbook `MatchupPreviewCard`.
 * Orients the signed-in team on the left when `myTeamId` is set.
 */
export function FantasyMatchupScoreCard({
  home,
  away,
  myTeamId,
  className,
  cacheKey = "native-matchup",
  weekStarted = false,
  matchupFinal = false,
  status,
}: FantasyMatchupScoreCardProps) {
  const mineIsAway = myTeamId != null && away.teamId === myTeamId;
  const left = mineIsAway ? away : home;
  const right = mineIsAway ? home : away;
  const leftProj = sideProj(left);
  const rightProj = sideProj(right);
  const myWinPct = sideWinPct(left, right);
  const oppWinPct =
    right.winPct != null && Number.isFinite(right.winPct)
      ? Math.max(1, Math.min(99, Math.round(right.winPct)))
      : Math.max(1, Math.min(99, 100 - myWinPct));
  const final = matchupFinal || status === "final";
  const started = weekStarted || status === "live" || left.points > 0.005 || right.points > 0.005;

  return (
    <div className={className}>
      <MatchupPreviewCard
        loading={false}
        leagueId={cacheKey}
        platform="native"
        myName={left.teamName}
        myLogo={left.avatarUrl ?? null}
        myRecord={formatRecord(left.wins, left.losses, left.ties)}
        myLive={left.points}
        myProj={leftProj}
        myWinPct={myWinPct}
        oppName={right.teamName}
        oppLogo={right.avatarUrl ?? null}
        oppRecord={formatRecord(right.wins, right.losses, right.ties)}
        oppLive={right.points}
        oppProj={rightProj}
        oppWinPct={oppWinPct}
        weekStarted={started}
        matchupFinal={final}
      />
    </div>
  );
}

function toAroundSide(team: FantasyMatchupTeamSide, winPct: number): AroundLeagueSide {
  return {
    id: team.teamId,
    name: team.teamName,
    logo: team.avatarUrl ?? null,
    live: team.points,
    proj: sideProj(team),
    winPct,
  };
}

/** Compact “Around the League” rows — identical layout to Playbook dashboard. */
export function FantasyAroundLeagueList({
  matchups,
  myTeamId: _myTeamId,
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
  void _myTeamId;
  if (!matchups.length) return null;

  return (
    <div className={cn("mt-5 border-t border-slate-200 pt-4", className)}>
      <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
        Around the League
      </span>
      <ul className="divide-y divide-slate-100">
        {matchups.map((m) => {
          const aPct = sideWinPct(m.home, m.away);
          const bPct =
            m.away.winPct != null && Number.isFinite(m.away.winPct)
              ? Math.max(1, Math.min(99, Math.round(m.away.winPct)))
              : Math.max(1, Math.min(99, 100 - aPct));
          const started =
            m.weekStarted || m.home.points > 0.005 || m.away.points > 0.005;
          const final = Boolean(m.matchupFinal);
          return (
            <AroundLeagueMatchupRow
              key={m.matchupId}
              a={toAroundSide(m.home, aPct)}
              b={toAroundSide(m.away, bPct)}
              started={started}
              final={final}
              platform="native"
              cacheKey={`${cacheKey}-${linkId}`}
              recordFor={(id) => {
                const side = m.home.teamId === id ? m.home : m.away.teamId === id ? m.away : null;
                if (!side) return null;
                return formatRecord(side.wins, side.losses, side.ties);
              }}
            />
          );
        })}
      </ul>
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
    <FantasyBoard className={className} title={title} bodyClassName="divide-y divide-slate-100">
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
  extras?: {
    homeProj?: number | null;
    awayProj?: number | null;
    homeWinPct?: number | null;
    awayWinPct?: number | null;
    weekStarted?: boolean;
    matchupFinal?: boolean;
  },
): FantasyMatchupCard {
  const avatarFor = (teamId: number) => {
    if (!avatars) return null;
    if (avatars instanceof Map) return avatars.get(teamId) ?? null;
    return avatars[teamId] ?? null;
  };
  const withMeta = (
    side: { teamId: number; teamName: string; points: number },
    proj?: number | null,
    winPct?: number | null,
  ) => {
    const rec = records?.get(side.teamId);
    return {
      ...side,
      avatarUrl: avatarFor(side.teamId),
      ...(rec ? { wins: rec.wins, losses: rec.losses, ties: rec.ties } : {}),
      ...(proj != null && Number.isFinite(proj) ? { projection: proj } : {}),
      ...(winPct != null && Number.isFinite(winPct) ? { winPct } : {}),
    };
  };
  const card: FantasyMatchupCard = {
    matchupId: m.matchupId,
    home: withMeta(m.home, extras?.homeProj, extras?.homeWinPct),
    away: withMeta(m.away, extras?.awayProj, extras?.awayWinPct),
  };
  if (extras?.weekStarted != null) card.weekStarted = extras.weekStarted;
  if (extras?.matchupFinal != null) card.matchupFinal = extras.matchupFinal;
  return card;
}
