import { Link } from "@tanstack/react-router";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import type { NativeMemberLeagueSummary } from "@/lib/native-league.functions";
import { cn } from "@/lib/utils";

function formatScore(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

function LeagueRow({
  league,
  selected,
  onSelect,
}: {
  league: NativeMemberLeagueSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const { setActiveLeagueId } = useActiveLeague();
  const teamLabel = league.teamName?.trim() || "My Team";
  const vsLabel = league.opponentName?.trim() || "TBD";
  const week = league.currentWeek || 1;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "flex items-center gap-3 border-t border-slate-200 px-3 py-3 first:border-t-0 transition-colors",
        selected ? "bg-blue-50/70" : "hover:bg-slate-50/80",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-100">
          {league.avatarUrl ? (
            <img
              src={league.avatarUrl}
              alt=""
              className="size-full object-cover"
              loading="lazy"
            />
          ) : (
            <span className="font-display text-sm font-bold uppercase tracking-wide text-slate-500">
              {(teamLabel.slice(0, 2) || "TM").toUpperCase()}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <Link
            to="/league/$linkId/my-team"
            params={{ linkId: league.linkId }}
            onClick={(e) => {
              e.stopPropagation();
              setActiveLeagueId(league.linkId);
            }}
            className="block truncate font-display text-sm font-bold uppercase tracking-wide text-slate-900 transition-colors hover:text-blue-600"
          >
            {teamLabel}
          </Link>
          <p className="mt-0.5 truncate text-xs text-slate-500">{league.name}</p>
        </div>
      </div>

      {/* Short centered rule so the matchup column sits level with the team block */}
      <div className="flex h-10 shrink-0 items-center" aria-hidden>
        <span className="h-8 w-px bg-slate-200" />
      </div>

      <div className="flex min-w-0 w-[8.5rem] shrink-0 flex-col justify-center text-right">
        <p className="truncate text-[11px] leading-tight text-slate-500">
          <span className="font-semibold uppercase tracking-wide">vs</span>{" "}
          <span className="font-semibold uppercase tracking-wide text-slate-700">{vsLabel}</span>
        </p>
        <p className="mt-0.5 text-[11px] font-medium text-slate-500">Week {week}</p>
        <p className="mt-0.5 font-display text-sm font-bold tabular-nums leading-none text-slate-900">
          {formatScore(league.myPoints)} - {formatScore(league.opponentPoints)}
        </p>
      </div>
    </div>
  );
}

export function FantasyLeaguesBox({
  leagues,
  loading,
  selectedLinkId,
  onSelectLeague,
}: {
  leagues: NativeMemberLeagueSummary[];
  loading?: boolean;
  selectedLinkId?: string | null;
  onSelectLeague?: (linkId: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-3 py-2.5">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide text-slate-900">
          Fantasy
        </h2>
      </div>

      {loading ? (
        <p className="px-3 py-6 text-sm text-slate-500">Loading your leagues…</p>
      ) : leagues.length === 0 ? (
        <p className="px-3 py-5 text-sm text-slate-600">
          You are not in a League Office league yet. Create or join one below.
        </p>
      ) : (
        <div>
          {leagues.map((league) => (
            <LeagueRow
              key={league.linkId}
              league={league}
              selected={selectedLinkId === league.linkId}
              onSelect={() => onSelectLeague?.(league.linkId)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
