import { ChevronRight } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { playbookPanelTitleClass, TeamAvatarBadge } from "@/components/playbook/panels";
import { ROOM_POSITIONS as POSITIONS, positionRoomRanks, rankValues } from "@/lib/position-room-ranks";
import type { StartingSlotRanks as SlotRanksData } from "@/lib/standings-projections.server";
import { cn } from "@/lib/utils";

export type SlotRankTeamMeta = {
  rosterId: number;
  team: string;
  owner: string;
  logo: string | null;
  isMine: boolean;
};

type View = "seats" | "positions";

const POS_TINT: Record<string, string> = {
  QB: "bg-qb/70 text-white border-qb/70",
  RB: "bg-rb/70 text-white border-rb/70",
  WR: "bg-wr/70 text-white border-wr/70",
  TE: "bg-te/70 text-white border-te/70",
};

const HEAT_TIERS = [
  { label: "Top", className: "bg-emerald-300 text-emerald-950" },
  { label: "Above avg", className: "bg-emerald-100 text-emerald-900" },
  { label: "Middle", className: "bg-slate-50 text-slate-700" },
  { label: "Below avg", className: "bg-rose-100 text-rose-900" },
  { label: "Bottom", className: "bg-rose-300 text-rose-950" },
] as const;

/** Five even tiers by rank: strong green for the best seats down to strong red for the worst. */
function heatClass(rank: number, teams: number): string {
  if (teams < 2) return HEAT_TIERS[2].className;
  const t = Math.min(1, Math.max(0, (rank - 1) / (teams - 1)));
  const tier = Math.round(t * (HEAT_TIERS.length - 1));
  return HEAT_TIERS[tier]!.className;
}

function shortName(name: string | null): string {
  if (!name) return "Empty";
  const parts = name.split(" ");
  return parts.length > 1 ? `${parts[0]![0]}. ${parts.slice(1).join(" ")}` : name;
}

function TeamCell({
  meta,
  platform,
  leagueKey,
}: {
  meta: SlotRankTeamMeta;
  platform: string | null;
  leagueKey: string;
}) {
  return (
    <span className="flex min-w-0 items-center">
      <TeamAvatarBadge
        name={meta.team}
        logo={meta.logo}
        platform={platform}
        cacheKey={`${leagueKey}-slots-${meta.rosterId}`}
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">{meta.team}</span>
          {meta.isMine ? <span className="shrink-0 text-[10px] font-black uppercase text-primary">You</span> : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{meta.owner || "Owner"}</span>
      </span>
    </span>
  );
}

export function StartingSlotRanks({
  data,
  loading,
  teams,
  platform,
  leagueKey,
}: {
  data: SlotRanksData | null | undefined;
  loading: boolean;
  teams: SlotRankTeamMeta[];
  platform: string | null;
  leagueKey: string;
}) {
  const [view, setView] = useState<View>("seats");
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [dropped, setDropped] = useState<Set<string>>(() => new Set());

  const metaById = useMemo(() => new Map(teams.map((t) => [t.rosterId, t])), [teams]);
  const rows = useMemo(
    () => (data?.teams ?? []).filter((t) => metaById.has(t.rosterId)).sort((a, b) => b.total - a.total),
    [data, metaById],
  );
  const teamCount = rows.length;

  const seatRanks = useMemo(
    () =>
      (data?.seats ?? []).map((_, seatIndex) =>
        rankValues(rows.map((r) => ({ id: r.rosterId, value: r.seats[seatIndex]?.ppg ?? 0 }))),
      ),
    [data, rows],
  );
  const totalRanks = useMemo(() => rankValues(rows.map((r) => ({ id: r.rosterId, value: r.total }))), [rows]);

  const positionRows = useMemo(() => {
    const { ppg, ranks: posRanks } = positionRoomRanks(rows);
    const sums = rows.map((r) => ({ rosterId: r.rosterId, byPos: ppg.get(r.rosterId)! as Record<string, number> }));
    const kept = sums
      .map((s) => ({
        ...s,
        total: POSITIONS.filter((pos) => !dropped.has(pos)).reduce((sum, pos) => sum + (s.byPos[pos] ?? 0), 0),
      }))
      .sort((a, b) => b.total - a.total);
    const max = Math.max(1, ...kept.map((k) => k.total));
    return { kept, max, posRanks };
  }, [rows, dropped]);

  const toggleDropped = (pos: string) =>
    setDropped((prev) => {
      const next = new Set(prev);
      if (next.has(pos)) next.delete(pos);
      else if (next.size < POSITIONS.length - 1) next.add(pos);
      return next;
    });

  const toggleExpanded = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const viewButton = (id: View, label: string) => (
    <button
      type="button"
      onClick={() => setView(id)}
      className={
        view === id
          ? "cursor-pointer select-none rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-black uppercase tracking-wide text-white shadow-sm"
          : "cursor-pointer select-none rounded-lg border border-slate-200/70 bg-slate-100 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 shadow-xs transition-colors hover:bg-slate-200/80 hover:text-slate-700"
      }
    >
      {label}
    </button>
  );

  const headerCell = "border-0 bg-slate-50/50 px-2 py-3 text-center text-[10px] font-bold uppercase tracking-wider text-slate-500";

  return (
    <section className="mt-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className={playbookPanelTitleClass}>{view === "seats" ? "Starting Slot Ranks" : "Starting Position Mix"}</h2>
        <div className="flex items-center gap-2">
          {viewButton("seats", "Seats")}
          {viewButton("positions", "Positions")}
        </div>
      </div>

      {loading && !rows.length ? (
        <p className="py-6 text-sm text-muted-foreground">Projecting every starting lineup…</p>
      ) : !rows.length ? (
        <p className="py-6 text-sm text-muted-foreground">Rest-of-season projections aren't available for this league yet.</p>
      ) : view === "seats" ? (
        <>
          <div className="overflow-x-auto overflow-y-hidden rounded-lg border border-border">
            <table className="w-full min-w-[1080px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[300px]" />
                {(data?.seats ?? []).map((label) => (
                  <col key={label} />
                ))}
                <col className="w-[104px]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border">
                  <th className={cn(headerCell, "pl-4 text-left")}>Team</th>
                  {(data?.seats ?? []).map((label) => (
                    <th key={label} className={headerCell}>
                      {label}
                    </th>
                  ))}
                  <th className={cn(headerCell, "pr-4 text-right")}>Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const meta = metaById.get(row.rosterId)!;
                  const open = expanded.has(row.rosterId);
                  const totalRank = totalRanks.get(row.rosterId) ?? teamCount;
                  return (
                    <Fragment key={row.rosterId}>
                      <tr className={cn("border-t border-border", meta.isMine && "bg-blue-50/60")}>
                        <td className="py-2 pl-2 pr-3 align-middle">
                          <span className="flex min-w-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => toggleExpanded(row.rosterId)}
                              aria-label={open ? `Hide ${meta.team} lineup` : `Show ${meta.team} lineup`}
                              aria-expanded={open}
                              className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-slate-400 transition-colors hover:text-blue-600"
                            >
                              <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
                            </button>
                            <TeamCell meta={meta} platform={platform} leagueKey={leagueKey} />
                          </span>
                        </td>
                        {row.seats.map((seat, seatIndex) => {
                          const rank = seatRanks[seatIndex]?.get(row.rosterId) ?? teamCount;
                          return (
                            <td
                              key={seat.label}
                              className={cn(
                                "border-l-2 border-white px-2 py-2 text-center align-middle text-sm font-bold tabular-nums",
                                heatClass(rank, teamCount),
                              )}
                              title={`${seat.label}: ${seat.name ?? "Empty"} · ${seat.ppg.toFixed(1)} PPG · #${rank} of ${teamCount}`}
                            >
                              {rank}
                            </td>
                          );
                        })}
                        <td
                          className={cn(
                            "border-l-2 border-white py-2 pl-2 pr-4 text-right align-middle text-sm font-black tabular-nums",
                            heatClass(totalRank, teamCount),
                          )}
                          title={`Total: #${totalRank} of ${teamCount}`}
                        >
                          {row.total.toFixed(1)}
                        </td>
                      </tr>
                      {open ? (
                        <tr className="border-t border-dashed border-slate-200 bg-slate-50/60">
                          <td className="py-2 pl-10 pr-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Projected PPG
                          </td>
                          {row.seats.map((seat) => (
                            <td key={seat.label} className="overflow-hidden px-2 py-2 text-center align-top">
                              <span className="block truncate text-xs font-semibold text-slate-800" title={seat.name ?? undefined}>
                                {shortName(seat.name)}
                              </span>
                              <span className="block truncate text-[11px] tabular-nums text-slate-500">
                                {seat.pos ? `${seat.pos} · ` : ""}
                                {seat.ppg.toFixed(1)}
                              </span>
                            </td>
                          ))}
                          <td className="py-2 pl-2 pr-4" />
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {HEAT_TIERS.map((tier) => (
              <span key={tier.label} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                <span className={cn("size-3 rounded-sm border border-slate-200", tier.className)} aria-hidden="true" />
                {tier.label}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs font-medium text-slate-500">
            Each lineup is the best one that roster can start, filled by projected rest-of-season points per game in this
            league's scoring. Total is that lineup's points; each seat is ranked against the same seat across the league.
          </p>
        </>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-border">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-slate-50/50 px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              {POSITIONS.map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => toggleDropped(pos)}
                  className={cn(
                    "flex cursor-pointer items-center gap-1.5 text-xs font-bold transition-opacity",
                    dropped.has(pos) ? "text-slate-400 line-through opacity-60" : "text-slate-700",
                  )}
                >
                  <span className={cn("size-3 rounded-sm border", POS_TINT[pos])} aria-hidden="true" />
                  {pos}
                </button>
              ))}
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Proj ROS PPG</span>
          </div>
          <ol className="space-y-1 p-2">
            {positionRows.kept.map((row, index) => {
              const meta = metaById.get(row.rosterId)!;
              return (
                <li
                  key={row.rosterId}
                  className={cn(
                    "grid grid-cols-[1.5rem_minmax(160px,220px)_minmax(0,1fr)_3.5rem] items-center gap-3 rounded-md px-2 py-1.5",
                    meta.isMine && "bg-blue-50/60",
                  )}
                >
                  <span className="text-center text-sm font-semibold tabular-nums text-slate-500">{index + 1}</span>
                  <TeamCell meta={meta} platform={platform} leagueKey={leagueKey} />
                  <div className="flex h-7 min-w-0 items-stretch gap-0.5">
                    {POSITIONS.filter((pos) => !dropped.has(pos)).map((pos) => {
                      const value = row.byPos[pos] ?? 0;
                      if (value <= 0) return null;
                      const width = (value / positionRows.max) * 100;
                      const rank = positionRows.posRanks[pos]?.get(row.rosterId) ?? teamCount;
                      return (
                        <button
                          key={pos}
                          type="button"
                          onClick={() => toggleDropped(pos)}
                          title={`${pos} · ${value.toFixed(1)} PPG · #${rank} of ${teamCount}`}
                          className={cn(
                            "flex cursor-pointer items-center justify-center overflow-hidden rounded-md border text-[11px] font-bold tabular-nums transition-opacity hover:opacity-75",
                            POS_TINT[pos],
                          )}
                          style={{ width: `${width}%` }}
                        >
                          {width >= 6 ? value.toFixed(1) : ""}
                        </button>
                      );
                    })}
                  </div>
                  <span className="text-right text-sm font-black tabular-nums text-slate-900">{row.total.toFixed(1)}</span>
                </li>
              );
            })}
          </ol>
          </div>
          <p className="mt-3 text-xs font-medium text-slate-500">
            Each bar is a team's best lineup, split by the projected rest-of-season points per game each position adds. A
            flex counts toward the position of whoever fills it, and all bars share one scale. Kickers and defenses are left
            out. Hover a segment for its rank, and click a segment or a position above to drop it and re-rank what's left.
          </p>
        </>
      )}
    </section>
  );
}
