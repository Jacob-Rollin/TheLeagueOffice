import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import { PositionBadge } from "@/components/draft/PositionBadge";
import { useActiveStandings } from "@/hooks/useActiveStandings";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useLeagueRosters, type ResolvedRosterTeam } from "@/hooks/useLeagueRosters";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Player } from "@/lib/draft";
import { starterRequirements } from "@/lib/power-rankings";
import { scaleValue } from "@/lib/trade-engine";
import { cn } from "@/lib/utils";

type RostersSearch = {
  scout?: string;
};

export const Route = createFileRoute("/playbook/rosters")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): RostersSearch => {
    const scout = typeof search["scout"] === "string" ? search["scout"] : undefined;
    return scout ? { scout } : {};
  },
  head: () => ({
    meta: [{ title: "Rosters — Playbook" }],
  }),
  component: PlaybookRostersPage,
});

const SKIP_STARTER_SLOTS = new Set(["BN", "BENCH", "IR", "IL", "TAXI", "RESERVE"]);
const FLEX_OK = new Set(["RB", "WR", "TE"]);
const CORE_POS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
const weeklyFallback = (p: Player) => Math.max(0, (p.proj?.half ?? 0) / 17);

type MatrixRow = {
  slot: string;
  player: Player | null;
};

function starterSlotLabels(rosterPositions: string[]): string[] {
  const labels = rosterPositions
    .map((pos) => String(pos ?? "").trim().toUpperCase())
    .filter((pos) => pos && !SKIP_STARTER_SLOTS.has(pos))
    .map((pos) =>
      pos === "SUPER_FLEX" || pos === "SUPERFLEX" || pos === "Q/W/R/T"
        ? "FLEX"
        : pos === "W/R/T" || pos === "WRRBTE"
          ? "FLEX"
          : pos,
    );
  if (labels.length) return labels;
  const req = starterRequirements([]);
  const out: string[] = [];
  for (const pos of ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"]) {
    for (let i = 0; i < (req[pos] ?? 0); i += 1) out.push(pos);
  }
  return out;
}

function buildStarterRows(
  team: ResolvedRosterTeam,
  rosterPositions: string[],
  projectFor: (id: string) => number | null,
): MatrixRow[] {
  const labels = starterSlotLabels(rosterPositions);
  const native = team.starters ?? [];

  if (native.length) {
    return labels.map((slot, i) => ({
      slot,
      player: native[i] ?? null,
    }));
  }

  const pool = team.players
    .filter((p) => !(team.ir ?? []).some((ir) => ir.id === p.id))
    .map((p) => ({
      id: p.id,
      pos: p.pos,
      weekly: projectFor(p.id) ?? weeklyFallback(p),
      player: p,
    }))
    .sort((a, b) => b.weekly - a.weekly);

  const used = new Set<string>();
  const rows: MatrixRow[] = [];
  for (const slot of labels) {
    const match = pool.find((p) => {
      if (used.has(p.id)) return false;
      if (slot === "FLEX") return FLEX_OK.has(p.pos);
      return p.pos === slot;
    });
    if (match) used.add(match.id);
    rows.push({ slot, player: match?.player ?? null });
  }

  return rows;
}

function ordinal(n: number): string {
  const v = Math.round(n);
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  switch (v % 10) {
    case 1:
      return `${v}st`;
    case 2:
      return `${v}nd`;
    case 3:
      return `${v}rd`;
    default:
      return `${v}th`;
  }
}

function RosterColumnHeader() {
  return (
    <div className="mb-3 grid grid-cols-[48px_1fr_120px_60px] items-center rounded-lg border border-slate-100 bg-slate-50 px-4 py-2 text-[10px] font-black tracking-widest text-slate-400 uppercase">
      <span>Pos</span>
      <span>Player</span>
      <span className="pr-6 text-right">Value / Trend</span>
      <span className="text-right">Proj</span>
    </div>
  );
}

function PlaybookRostersPage() {
  const { scout } = Route.useSearch();
  const preferredSlot = scout ?? null;
  const navigate = useNavigate();
  const modalRef = useRef<PlayerModalHandle>(null);
  const openPlayer = (id: string) => modalRef.current?.open(id);

  const { data: playersPayload, loading: playersLoading } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const { teams, myTeam, rosterPositions, loading: rostersLoading } = useLeagueRosters(players);
  const { standings, loading: standingsLoading } = useActiveStandings();
  const { projectFor, loading: projectionsLoading } = useLeagueProjections();
  const brain = usePlayerBrain();
  const [selectedSlot, setSelectedSlot] = useState<string>("");

  useEffect(() => {
    if (preferredSlot && teams.some((t) => String(t.slot) === preferredSlot)) {
      setSelectedSlot(preferredSlot);
      return;
    }
    if (!teams.length) {
      setSelectedSlot("");
      return;
    }
    const stillValid = teams.some((t) => String(t.slot) === selectedSlot);
    if (stillValid) return;
    const preferred = myTeam ?? teams[0];
    setSelectedSlot(preferred ? String(preferred.slot) : "");
  }, [teams, myTeam, selectedSlot, preferredSlot]);

  const selectManager = (slot: string) => {
    setSelectedSlot(slot);
    void navigate({
      to: "/playbook/rosters",
      search: slot ? { scout: slot } : {},
      replace: true,
    });
  };

  const selectedTeam = useMemo(
    () => teams.find((t) => String(t.slot) === selectedSlot) ?? null,
    [teams, selectedSlot],
  );

  const starterRows = useMemo(() => {
    if (!selectedTeam) return [] as MatrixRow[];
    return buildStarterRows(selectedTeam, rosterPositions, projectFor);
  }, [selectedTeam, rosterPositions, projectFor]);

  const starterIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of starterRows) if (row.player) ids.add(row.player.id);
    return ids;
  }, [starterRows]);

  const benchRows = useMemo(() => {
    if (!selectedTeam) return [] as MatrixRow[];
    const irIds = new Set((selectedTeam.ir ?? []).map((p) => p.id));
    return (selectedTeam.bench ?? [])
      .filter((p) => !starterIds.has(p.id) && !irIds.has(p.id))
      .map((p) => ({ slot: "BN", player: p as Player | null }));
  }, [selectedTeam, starterIds]);

  const irRows = useMemo(() => {
    if (!selectedTeam) return [] as MatrixRow[];
    return (selectedTeam.ir ?? []).map((p) => ({ slot: "IR", player: p as Player | null }));
  }, [selectedTeam]);

  const managerIntel = useMemo(() => {
    if (!selectedTeam) return null;
    const rows = standings?.rows ?? [];
    const standingBySlot = new Map(rows.map((r) => [r.rosterId, r]));
    const standing =
      standingBySlot.get(selectedTeam.slot) ??
      rows.find(
        (r) =>
          r.team.trim().toLowerCase() === selectedTeam.team.trim().toLowerCase() ||
          (selectedTeam.owner &&
            r.owner.trim().toLowerCase() === selectedTeam.owner.trim().toLowerCase()),
      ) ??
      null;

    const sortedByRecord = [...rows].sort(
      (a, b) => b.wins - a.wins || a.losses - b.losses || b.pointsFor - a.pointsFor,
    );
    const leagueSize = Math.max(teams.length, sortedByRecord.length, 1);
    const rankIndex = standing
      ? sortedByRecord.findIndex((r) => r.rosterId === standing.rosterId)
      : -1;
    const leagueRank = rankIndex >= 0 ? rankIndex + 1 : null;

    const pfSorted = [...rows].sort((a, b) => b.pointsFor - a.pointsFor);
    const pfRankIndex = standing
      ? pfSorted.findIndex((r) => r.rosterId === standing.rosterId)
      : -1;
    const pfRank = pfRankIndex >= 0 ? pfRankIndex + 1 : null;
    const pointsFor = standing?.pointsFor ?? null;

    const rosterSize = selectedTeam.players.length || 1;
    const irCount = (selectedTeam.ir ?? []).length;
    const activeCount = Math.max(0, rosterSize - irCount);
    const healthPct = Math.round((activeCount / rosterSize) * 100);

    const emptyStarters = starterRows.filter((r) => !r.player).length;
    const posCounts: Record<string, number> = {};
    for (const p of selectedTeam.players) {
      posCounts[p.pos] = (posCounts[p.pos] ?? 0) + 1;
    }
    const req = starterRequirements(rosterPositions);
    let holeCount = emptyStarters;
    let clogPos: string | null = null;
    let clogExtra = 0;
    for (const pos of CORE_POS) {
      const have = posCounts[pos] ?? 0;
      const need = req[pos] ?? 0;
      if (have < need) holeCount += need - have;
      const extra = have - Math.max(need, 1);
      if (extra > clogExtra) {
        clogExtra = extra;
        clogPos = pos;
      }
    }

    let urgency = "LOW";
    let urgencyNote = "Balanced";
    if (holeCount >= 3 || emptyStarters >= 2) {
      urgency = "HIGH";
      urgencyNote = clogExtra >= 2 && clogPos ? "Bench Clog" : "Depth Holes";
    } else if (holeCount >= 1 || clogExtra >= 3) {
      urgency = "MED";
      urgencyNote = clogExtra >= 3 && clogPos ? `${clogPos} Clog` : "Thin Spots";
    } else if (clogExtra >= 2 && clogPos) {
      urgency = "MED";
      urgencyNote = "Bench Clog";
    }

    return {
      leagueRankLabel:
        leagueRank != null ? `${ordinal(leagueRank)} of ${leagueSize}` : `— of ${leagueSize}`,
      pointsForLabel:
        pointsFor != null
          ? `${pointsFor.toFixed(1)} pts${pfRank != null ? ` · Rank ${pfRank}` : ""}`
          : "—",
      healthLabel: `${healthPct}% · ${irCount} Active IR`,
      urgencyLabel: `${urgency} · ${urgencyNote}`,
    };
  }, [selectedTeam, standings, teams.length, starterRows, rosterPositions]);

  const topTargets = useMemo(() => {
    if (!selectedTeam || !myTeam || selectedTeam.slot === myTeam.slot) return [] as Player[];

    const myStarters = buildStarterRows(myTeam, rosterPositions, projectFor);
    const myNeedScore = new Map<string, number>();
    for (const pos of CORE_POS) myNeedScore.set(pos, 0);

    for (const row of myStarters) {
      const pos = row.slot === "FLEX" ? row.player?.pos ?? "FLEX" : row.slot;
      if (!row.player) {
        myNeedScore.set(pos, (myNeedScore.get(pos) ?? 0) + 3);
        continue;
      }
      const weekly = projectFor(row.player.id) ?? weeklyFallback(row.player);
      if (weekly < 8) myNeedScore.set(pos, (myNeedScore.get(pos) ?? 0) + 1.5);
      else if (weekly < 12) myNeedScore.set(pos, (myNeedScore.get(pos) ?? 0) + 0.5);
    }

    const scored = selectedTeam.players
      .filter((p) => !(selectedTeam.ir ?? []).some((ir) => ir.id === p.id))
      .map((p) => {
        const market = scaleValue(brain?.[p.id]?.value ?? 0);
        const need = myNeedScore.get(p.pos) ?? 0;
        const weekly = projectFor(p.id) ?? weeklyFallback(p);
        return { player: p, score: market * 1.2 + need * 4 + weekly * 0.35 };
      })
      .sort((a, b) => b.score - a.score);

    const out: Player[] = [];
    for (const hit of scored) {
      if (out.length >= 2) break;
      if ((myNeedScore.get(hit.player.pos) ?? 0) > 0 || out.length === 0) {
        out.push(hit.player);
      }
    }
    if (out.length < 2) {
      for (const hit of scored) {
        if (out.length >= 2) break;
        if (!out.some((p) => p.id === hit.player.id)) out.push(hit.player);
      }
    }
    return out.slice(0, 2);
  }, [selectedTeam, myTeam, rosterPositions, projectFor, brain]);

  const loading =
    playersLoading || rostersLoading || projectionsLoading || standingsLoading;

  const valueTrend = (p: Player | null) => {
    if (!p) return "—";
    const entry = brain?.[p.id];
    const value = scaleValue(entry?.value ?? 0);
    const trend = entry?.trend ?? 0;
    const trendText = `${trend >= 0 ? "+" : ""}${trend.toFixed(1)}`;
    return `${value.toFixed(1)} / ${trendText}`;
  };

  const projPts = (p: Player | null) => {
    if (!p) return "—";
    const pts = projectFor(p.id) ?? weeklyFallback(p);
    return pts.toFixed(1);
  };

  return (
    <div className="w-full">
      <div className="mb-4 flex flex-col items-start justify-between border-b border-slate-100 pb-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-lg font-black tracking-wide text-slate-900 uppercase">
            Roster Matrix
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Scout any manager lineup, bench depth, and IR slots in the active league.
          </p>
        </div>
        <label className="mt-3 flex min-w-[14rem] flex-col gap-1 text-xs font-semibold tracking-wide text-slate-500 uppercase md:mt-0">
          Manager Team
          <select
            value={selectedSlot}
            onChange={(e) => selectManager(e.target.value)}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium tracking-normal text-slate-900 normal-case outline-none focus:border-blue-500"
          >
            {!teams.length ? <option value="">No teams available</option> : null}
            {teams.map((team) => (
              <option key={team.slot} value={String(team.slot)}>
                {team.team}
                {team.owner ? ` · ${team.owner}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && !selectedTeam ? (
        <p className="py-8 text-center text-sm text-slate-400">Loading roster matrix…</p>
      ) : !selectedTeam ? (
        <p className="py-8 text-center text-sm text-slate-400">
          No roster data available for this league yet.
        </p>
      ) : (
        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-start gap-6 overflow-visible lg:grid-cols-[1fr_360px]">
          <div className="flex flex-col space-y-6 rounded-xl border border-slate-200 bg-white p-6 text-left shadow-sm">
            <section>
              <h3 className="mb-3 text-xs font-black tracking-wider text-slate-900 uppercase">
                STARTING LINEUP
              </h3>
              <RosterColumnHeader />
              <div className="overflow-hidden rounded-lg">
                {starterRows.length === 0 ? (
                  <p className="py-4 text-sm text-slate-400">No starting lineup slots available.</p>
                ) : (
                  starterRows.map((row, index) => (
                    <RosterPlayerRow
                      key={`${row.slot}-${row.player?.id ?? "empty"}-${index}`}
                      row={row}
                      index={index}
                      valueTrend={valueTrend(row.player)}
                      projPts={projPts(row.player)}
                      onOpenPlayer={openPlayer}
                    />
                  ))
                )}
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-xs font-black tracking-wider text-slate-900 uppercase">
                BENCH DEPTH
              </h3>
              <RosterColumnHeader />
              <div className="overflow-hidden rounded-lg">
                {benchRows.length === 0 ? (
                  <p className="py-4 text-sm text-slate-400">No bench assets on this roster.</p>
                ) : (
                  benchRows.map((row, index) => (
                    <RosterPlayerRow
                      key={`bn-${row.player?.id ?? "empty"}-${index}`}
                      row={row}
                      index={index}
                      valueTrend={valueTrend(row.player)}
                      projPts={projPts(row.player)}
                      onOpenPlayer={openPlayer}
                      condensed
                    />
                  ))
                )}
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-xs font-black tracking-wider text-slate-900 uppercase">
                INJURED RESERVE
              </h3>
              {irRows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-5 text-center text-sm text-slate-400">
                  IR slot empty.
                </div>
              ) : (
                <>
                  <RosterColumnHeader />
                  <div className="overflow-hidden rounded-lg">
                    {irRows.map((row, index) => (
                      <RosterPlayerRow
                        key={`ir-${row.player?.id ?? "empty"}-${index}`}
                        row={row}
                        index={index}
                        valueTrend={valueTrend(row.player)}
                        projPts={projPts(row.player)}
                        onOpenPlayer={openPlayer}
                        showIrBadge
                        condensed
                      />
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>

          <div className="flex w-full flex-col space-y-6 text-left">
            <section className="flex w-full flex-col rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm">
              <h3 className="mb-3 border-b border-slate-100 pb-2 text-xs font-black tracking-wider text-slate-900 uppercase">
                MANAGER PROFILE
              </h3>
              <dl className="space-y-3">
                <IntelRow label="League Rank" value={managerIntel?.leagueRankLabel ?? "—"} />
                <IntelRow label="Points For (PF)" value={managerIntel?.pointsForLabel ?? "—"} />
                <IntelRow label="Roster Health" value={managerIntel?.healthLabel ?? "—"} />
                <IntelRow label="Trade Urgency" value={managerIntel?.urgencyLabel ?? "—"} />
              </dl>
            </section>

            <section className="flex w-full flex-col rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm">
              <h3 className="mb-3 border-b border-slate-100 pb-2 text-xs font-black tracking-wider text-slate-900 uppercase">
                TOP TARGET ASSETS
              </h3>
              {selectedTeam.isMine || selectedTeam.slot === myTeam?.slot ? (
                <p className="py-3 text-sm text-slate-400">
                  Select a rival manager to surface high-probability trade targets.
                </p>
              ) : topTargets.length === 0 ? (
                <p className="py-3 text-sm text-slate-400">No optimized trade fits found yet.</p>
              ) : (
                <div className="space-y-3">
                  {topTargets.map((player) => (
                    <div
                      key={player.id}
                      className="flex items-center gap-2.5 rounded-lg border border-slate-100 bg-slate-50/40 px-2.5 py-2"
                    >
                      <button
                        type="button"
                        onClick={() => openPlayer(player.id)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        <PlayerAvatar
                          id={player.id}
                          pos={player.pos}
                          team={player.team}
                          name={player.name}
                          className="size-8 flex-shrink-0"
                          logoClassName="size-2.5"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-black text-slate-900">
                            {player.name}
                          </span>
                          <span className="mt-0.5 inline-flex">
                            <PositionBadge pos={player.pos} className="h-4 text-[9px]" />
                          </span>
                        </span>
                      </button>
                      <Link
                        to="/trade"
                        className="ml-auto flex-shrink-0 text-[11px] font-black tracking-wide text-blue-600 uppercase transition-colors hover:text-blue-700"
                      >
                        Scout Trade
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      <PlayerModalHost ref={modalRef} />
    </div>
  );
}

function IntelRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[11px] font-bold tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="text-right text-xs font-black text-slate-900">{value}</dd>
    </div>
  );
}

function RosterPlayerRow({
  row,
  index,
  valueTrend,
  projPts,
  onOpenPlayer,
  condensed = false,
  showIrBadge = false,
}: {
  row: MatrixRow;
  index: number;
  valueTrend: string;
  projPts: string;
  onOpenPlayer: (id: string) => void;
  condensed?: boolean;
  showIrBadge?: boolean;
}) {
  const player = row.player;
  const tone = index % 2 === 1 ? "bg-slate-50/40" : "bg-white";

  if (!player) {
    return (
      <div
        className={cn(
          "grid grid-cols-[48px_1fr_120px_60px] items-center border-b border-slate-100 px-4 py-2.5 last:border-0",
          tone,
        )}
      >
        <PositionBadge pos={row.slot} className="h-5 text-[10px]" />
        <span className="text-xs text-slate-400 italic">Empty slot</span>
        <span className="pr-6 text-right text-[11px] text-slate-300">—</span>
        <span className="text-right text-xs text-slate-300">—</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid grid-cols-[48px_1fr_120px_60px] items-center border-b border-slate-100 px-4 py-2.5 last:border-0",
        tone,
      )}
    >
      <PositionBadge pos={row.slot} className="h-5 text-[10px]" />
      <button
        type="button"
        onClick={() => onOpenPlayer(player.id)}
        className="flex min-w-0 items-center text-left transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <PlayerAvatar
          id={player.id}
          pos={player.pos}
          team={player.team}
          name={player.name}
          className={cn("relative flex-shrink-0", condensed ? "size-8" : "size-9")}
          logoClassName="size-3"
        />
        <span className="ml-3 min-w-0">
          <span className="flex max-w-[140px] items-center gap-1.5 truncate text-xs font-black text-slate-900">
            {player.name}
            {showIrBadge ? (
              <span className="rounded bg-red-500 px-1.5 py-0.5 text-[9px] font-black tracking-wider text-white">
                IR
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block text-[10px] font-bold tracking-wide text-slate-400 uppercase">
            {player.team?.trim() || "FA"}
          </span>
        </span>
      </button>
      <span className="pr-6 text-right text-[11px] font-semibold tabular-nums text-slate-500">
        {valueTrend}
      </span>
      <span className="text-right text-xs font-black tabular-nums text-slate-900">{projPts}</span>
    </div>
  );
}
