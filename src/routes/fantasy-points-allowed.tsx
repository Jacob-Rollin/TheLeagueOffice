import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";

import { teamLogo } from "@/components/draft/PlayerAvatar";
import { getFantasyPointsAllowed } from "@/lib/players.functions";
import type { FantasyPointsAllowedPos } from "@/lib/players.server";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/fantasy-points-allowed")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Fantasy Points Allowed — The League Office" },
      {
        name: "description",
        content:
          "NFL defense fantasy points allowed and matchup ranks by position — easy and tough matchups at a glance.",
      },
    ],
  }),
  component: FantasyPointsAllowedPage,
});

const POS_COLS: { key: FantasyPointsAllowedPos; label: string }[] = [
  { key: "QB", label: "QB" },
  { key: "RB", label: "RB" },
  { key: "WR", label: "WR" },
  { key: "TE", label: "TE" },
  { key: "K", label: "K" },
  { key: "DEF", label: "DST" },
];

type SortKey = "team" | FantasyPointsAllowedPos;

function matchupTone(rank: number | null): string {
  if (rank == null) return "";
  if (rank <= 8) return "bg-emerald-100/90 text-emerald-900";
  if (rank >= 25) return "bg-rose-100/90 text-rose-900";
  return "";
}

function FantasyPointsAllowedPage() {
  const [sortKey, setSortKey] = useState<SortKey>("team");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const query = useQuery({
    queryKey: ["fantasy-points-allowed"],
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
    queryFn: () => getFantasyPointsAllowed(),
  });

  const payload = query.data;
  const rows = useMemo(() => {
    const list = [...(payload?.rows ?? [])];
    list.sort((a, b) => {
      if (sortKey === "team") {
        const cmp = a.teamName.localeCompare(b.teamName);
        return sortDir === "asc" ? cmp : -cmp;
      }
      const aPa = a.cells[sortKey]?.pa;
      const bPa = b.cells[sortKey]?.pa;
      const av = aPa == null ? -999 : aPa;
      const bv = bPa == null ? -999 : bPa;
      const cmp = av - bv;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [payload?.rows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "team" ? "asc" : "desc");
  };

  const weekLabel =
    payload && payload.weeksTo > 0
      ? `Average Per Game Weeks ${payload.weeksFrom} – ${payload.weeksTo} in ${payload.season}`
      : payload
        ? `Season ${payload.season}`
        : "Loading defense matchup board…";

  return (
    <main className="mx-auto w-full max-w-6xl px-3 pb-16 pt-6">
      <div className="mb-5">
        <h1 className="display-title text-2xl uppercase tracking-wide text-slate-900 sm:text-3xl">
          Fantasy Points Allowed
        </h1>
        <p className="mt-1 text-sm text-slate-500">{weekLabel}</p>
      </div>

      <div className="mb-4 rounded-xl border border-sky-100 bg-sky-50/80 px-4 py-3 text-sm text-slate-600">
        <p className="font-semibold text-slate-800">What are Fantasy Points Allowed?</p>
        <p className="mt-1 leading-relaxed">
          Each cell shows how many fantasy points a defense allows per game to that position, plus
          the matchup rank. Rank 1 is the easiest matchup (most points allowed). Top 8 ranks are
          easy; bottom 8 are tough.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4 text-[11px] font-black uppercase tracking-wider text-slate-600">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block size-3 rounded-sm bg-emerald-200" aria-hidden="true" />
          Easy Matchup (Top 8)
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block size-3 rounded-sm bg-rose-200" aria-hidden="true" />
          Tough Matchup (Bottom 8)
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-700">
                <th
                  rowSpan={2}
                  className="sticky left-0 z-10 border-r border-slate-200 bg-slate-50 px-3 py-2.5 text-left align-bottom"
                >
                  <button
                    type="button"
                    onClick={() => toggleSort("team")}
                    className="inline-flex items-center gap-1 uppercase tracking-widest hover:text-slate-900"
                  >
                    Team
                    {sortKey === "team" ? (
                      <span aria-hidden="true">{sortDir === "asc" ? "▲" : "▼"}</span>
                    ) : null}
                  </button>
                </th>
                {POS_COLS.map((pos) => (
                  <th
                    key={pos.key}
                    colSpan={2}
                    className="border-l border-slate-200 px-2 py-2 text-center"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(pos.key)}
                      className="inline-flex items-center gap-1 uppercase tracking-widest hover:text-slate-900"
                    >
                      {pos.label}
                      {sortKey === pos.key ? (
                        <span aria-hidden="true">{sortDir === "asc" ? "▲" : "▼"}</span>
                      ) : null}
                    </button>
                  </th>
                ))}
              </tr>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-black uppercase tracking-widest text-slate-500">
                {POS_COLS.map((pos) => (
                  <Fragment key={pos.key}>
                    <th className="border-l border-slate-200 px-1.5 py-1.5 text-center font-bold">
                      RK
                    </th>
                    <th className="px-1.5 py-1.5 text-center font-bold">PA</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {query.isLoading ? (
                <tr>
                  <td
                    colSpan={1 + POS_COLS.length * 2}
                    className="px-4 py-10 text-center text-slate-400"
                  >
                    Loading fantasy points allowed…
                  </td>
                </tr>
              ) : query.isError ? (
                <tr>
                  <td
                    colSpan={1 + POS_COLS.length * 2}
                    className="px-4 py-10 text-center text-rose-600"
                  >
                    Could not load defense points-allowed data. Try again shortly.
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={1 + POS_COLS.length * 2}
                    className="px-4 py-10 text-center text-slate-400"
                  >
                    No points-allowed data available yet for this season.
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => {
                  const zebra = index % 2 === 1 ? "bg-slate-50/50" : "bg-white";
                  const logo = teamLogo(row.team);
                  return (
                    <tr key={row.team} className={cn("border-b border-slate-100", zebra)}>
                      <td
                        className={cn(
                          "sticky left-0 z-10 border-r border-slate-100 px-3 py-2.5",
                          zebra,
                        )}
                      >
                        <Link
                          to="/nfl-team/$nflId"
                          params={{ nflId: row.team }}
                          className="flex min-w-0 items-center gap-2.5 font-semibold text-blue-700 transition-opacity hover:opacity-85"
                        >
                          {logo ? (
                            <img
                              src={logo}
                              alt=""
                              className="size-6 shrink-0 object-contain"
                              loading="lazy"
                            />
                          ) : null}
                          <span className="truncate">{row.teamName}</span>
                        </Link>
                      </td>
                      {POS_COLS.map((pos) => {
                        const cell = row.cells[pos.key];
                        const tone = matchupTone(cell?.rank ?? null);
                        return (
                          <Fragment key={`${row.team}-${pos.key}`}>
                            <td
                              className={cn(
                                "border-l border-slate-100 px-1.5 py-2 text-center tabular-nums",
                                tone,
                              )}
                            >
                              {cell?.rank != null ? cell.rank : "—"}
                            </td>
                            <td
                              className={cn(
                                "px-1.5 py-2 text-center font-medium tabular-nums",
                                tone,
                              )}
                            >
                              {cell?.pa != null ? cell.pa.toFixed(1) : "—"}
                            </td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
