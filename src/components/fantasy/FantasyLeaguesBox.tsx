import { Link } from "@tanstack/react-router";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import type { NativeMemberLeagueSummary } from "@/lib/native-league.functions";
import { cn } from "@/lib/utils";

function formatScore(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

function LeagueRow({ league }: { league: NativeMemberLeagueSummary }) {
  const { setActiveLeagueId } = useActiveLeague();
  const teamLabel = league.teamName?.trim() || "My Team";
  const vsLabel = league.opponentName?.trim() || "TBD";
  const week = league.currentWeek || 1;

  return (
    <div className="flex items-stretch gap-3 border-t border-slate-200 px-3 py-3 first:border-t-0">
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
            onClick={() => setActiveLeagueId(league.linkId)}
            className="block truncate font-display text-sm font-bold uppercase tracking-wide text-slate-900 transition-colors hover:text-blue-600"
          >
            {teamLabel}
          </Link>
          <p className="mt-0.5 truncate text-xs text-slate-500">{league.name}</p>
        </div>
      </div>

      <div
        className="w-px shrink-0 self-stretch bg-slate-200"
        aria-hidden
      />

      <div className="flex w-[7.5rem] shrink-0 flex-col items-end justify-center text-right">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-600">
          VS {vsLabel}
        </p>
        <p className="mt-0.5 text-[11px] font-medium text-slate-500">Week {week}</p>
        <p className="mt-0.5 font-display text-sm font-bold tabular-nums text-slate-900">
          {formatScore(league.myPoints)} - {formatScore(league.opponentPoints)}
        </p>
      </div>
    </div>
  );
}

export function FantasyLeaguesBox({
  leagues,
  loading,
}: {
  leagues: NativeMemberLeagueSummary[];
  loading?: boolean;
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
        <div className="space-y-3 px-3 py-5">
          <p className="text-sm text-slate-600">
            You are not in a League Office league yet.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/account/leagues/setup"
              className="inline-flex items-center rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white hover:bg-blue-700"
            >
              Create a League
            </Link>
            <Link
              to="/account/leagues/join"
              className={cn(
                "inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5",
                "text-xs font-semibold uppercase tracking-wide text-blue-700 hover:border-blue-600",
              )}
            >
              Join a League
            </Link>
          </div>
        </div>
      ) : (
        <div>
          {leagues.map((league) => (
            <LeagueRow key={league.linkId} league={league} />
          ))}
        </div>
      )}
    </section>
  );
}
