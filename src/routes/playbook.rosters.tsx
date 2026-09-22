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
    <div className="flex w-full items-center justify-between border-b border-border bg-slate-50/60 px-3 py-3 text-xs font-black uppercase tracking-wider text-slate-900 select-none">
      <div className="flex min-w-0 flex-1 items-center">
        <span className="w-12 shrink-0">Pos</span>
        <span>Player</span>
      </div>
      <div className="flex shrink-0 items-center space-x-12 pr-1">
        <span className="w-28 text-right">Value / Trend</span>
        <span className="w-12 text-right">Proj</span>
      </div>
    </div>
  );
}

type RosterSection = "starters" | "bench" | "ir";

function badgeLabelForRow(row: MatrixRow, section: RosterSection): string {
  if (section === "bench") return "BN";
  if (section === "ir") return "IR";
  return row.slot || row.player?.pos || "BN";
}

const rosterListShellClass =
  "mb-6 select-none overflow-hidden rounded-lg border border-border bg-white";
const rosterListBodyClass = "divide-y divide-slate-100";


function RosterInjuryBadge({
  player,
  forceIr = false,
}: {
  player: Player;
  forceIr?: boolean;
}) {
  if (forceIr) {
    return (
      <span className="shrink-0 rounded bg-red-700 px-1 py-0.5 text-[8px] font-black uppercase leading-none tracking-wider text-white">
        IR
      </span>
    );
  }

  const raw = (player.injury || player.injury_status || player.injuryStatus || "")
    .trim()
    .toUpperCase();
  if (!raw || /^(HEALTHY|ACTIVE|NONE)$/.test(raw)) return null;

  let label: "Q" | "O" | "IR" | null = null;
  let tone = "bg-amber-500";
  if (raw === "IR" || raw === "INJURED RESERVE" || raw === "PUP") {
    label = "IR";
    tone = "bg-red-700";
  } else if (raw === "Q" || raw === "QUESTIONABLE") {
    label = "Q";
    tone = "bg-amber-500";
  } else if (
    raw === "O" ||
    raw === "OUT" ||
    raw === "DOUBTFUL" ||
    raw === "D" ||
    raw === "SUSPENDED" ||
    raw === "NA" ||
    raw === "INACTIVE"
  ) {
    label = "O";
    tone = "bg-rose-600";
  }
  if (!label) return null;

  return (
    <span
      className={cn(
        "shrink-0 rounded px-1 py-0.5 text-[8px] font-black uppercase leading-none tracking-wider text-white",
        tone,
      )}
    >
      {label}
    </span>
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
    return pts.toFixed(2);
  };

  const managerSelect = (
    <div className="mt-3 flex flex-col items-start sm:mt-0 sm:items-end">
      <span className="mb-1.5 mr-1 block text-[10px] font-black uppercase tracking-widest text-slate-400 sm:text-right">
        Manager Team
      </span>
      <select
        value={selectedSlot}
        onChange={(e) => selectManager(e.target.value)}
        className="w-[260px] cursor-pointer select-none rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-xs font-black uppercase tracking-wide text-slate-700 shadow-2xs focus:outline-none"
      >
        {!teams.length ? <option value="">No teams available</option> : null}
        {teams.map((team) => (
          <option key={team.slot} value={String(team.slot)}>
            {team.team}
            {team.owner ? ` · ${team.owner}` : ""}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="w-full">
      <div className="mb-6 flex w-full flex-col border-b border-slate-100 pb-4 select-none sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col text-left">
          <h1 className="text-xl font-black uppercase tracking-tight text-slate-900">
            Roster Matrix
          </h1>
          <p className="mt-1 text-xs font-bold text-slate-400">
            Scout any manager lineup, bench depth, and IR slots in the active league.
          </p>
        </div>
        {managerSelect}
      </div>

      {loading && !selectedTeam ? (
        <p className="py-8 text-center text-sm text-slate-400">Loading roster matrix…</p>
      ) : !selectedTeam ? (
        <p className="py-8 text-center text-sm text-slate-400">
          No roster data available for this league yet.
        </p>
      ) : (
        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-start gap-6 overflow-visible lg:grid-cols-[1fr_360px]">
          <div className="flex flex-col text-left">
            <section className="mb-2">
              <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-slate-900">
                Starters
              </h3>
              <div className={rosterListShellClass}>
                <RosterColumnHeader />
                <div className={rosterListBodyClass}>
                  {starterRows.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-slate-400">
                      No starting lineup slots available.
                    </p>
                  ) : (
                    starterRows.map((row, index) => (
                      <RosterPlayerRow
                        key={`${row.slot}-${row.player?.id ?? "empty"}-${index}`}
                        row={row}
                        section="starters"
                        valueTrend={valueTrend(row.player)}
                        projPts={projPts(row.player)}
                        onOpenPlayer={openPlayer}
                      />
                    ))
                  )}
                </div>
              </div>
            </section>

            <section className="mb-2">
              <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-slate-900">
                Bench
              </h3>
              <div className={rosterListShellClass}>
                <RosterColumnHeader />
                <div className={rosterListBodyClass}>
                  {benchRows.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-slate-400">No bench assets on this roster.</p>
                  ) : (
                    benchRows.map((row, index) => (
                      <RosterPlayerRow
                        key={`bn-${row.player?.id ?? "empty"}-${index}`}
                        row={row}
                        section="bench"
                        valueTrend={valueTrend(row.player)}
                        projPts={projPts(row.player)}
                        onOpenPlayer={openPlayer}
                      />
                    ))
                  )}
                </div>
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-slate-900">
                Injured Reserve
              </h3>
              {irRows.length === 0 ? (
                <div className="mb-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-5 text-center text-sm text-slate-400">
                  IR slot empty.
                </div>
              ) : (
                <div className={rosterListShellClass}>
                  <RosterColumnHeader />
                  <div className={rosterListBodyClass}>
                    {irRows.map((row, index) => (
                      <RosterPlayerRow
                        key={`ir-${row.player?.id ?? "empty"}-${index}`}
                        row={row}
                        section="ir"
                        valueTrend={valueTrend(row.player)}
                        projPts={projPts(row.player)}
                        onOpenPlayer={openPlayer}
                        showIrBadge
                      />
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>

          <div className="flex w-full flex-col text-left pt-0">
            {/* Match Starters section title height so Manager Profile aligns with grey table header */}
            <div className="mb-3 hidden lg:block" aria-hidden="true">
              <h3 className="invisible text-xs font-black uppercase tracking-wider">Starters</h3>
            </div>

            <div className="flex w-full flex-col space-y-6">
              <section className="flex w-full flex-col rounded-xl border border-slate-100 bg-white p-4 text-left shadow-xs">
                <h3 className="mb-3 border-b border-slate-100 pb-2 text-xs font-black uppercase tracking-wider text-slate-900">
                  Manager Profile
                </h3>
                <dl className="space-y-3">
                  <IntelRow label="League Rank" value={managerIntel?.leagueRankLabel ?? "—"} />
                  <IntelRow label="Points For (PF)" value={managerIntel?.pointsForLabel ?? "—"} />
                  <IntelRow label="Roster Health" value={managerIntel?.healthLabel ?? "—"} />
                  <IntelRow label="Trade Urgency" value={managerIntel?.urgencyLabel ?? "—"} />
                </dl>
              </section>

              <section className="flex w-full flex-col rounded-xl border border-slate-100 bg-white p-4 text-left shadow-xs">
                <h3 className="mb-3 border-b border-slate-100 pb-2 text-xs font-black uppercase tracking-wider text-slate-900">
                  Top Target Assets
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
                        className="flex items-center gap-2.5 rounded-xl border border-slate-100/60 bg-white px-2.5 py-2 shadow-xs"
                      >
                        <button
                          type="button"
                          onClick={() => openPlayer(player.id)}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
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
                            <span className="flex items-center gap-1.5 truncate text-sm font-black text-slate-900">
                              <span className="truncate">{player.name}</span>
                              <RosterInjuryBadge player={player} />
                            </span>
                            <span className="mt-0.5 inline-flex">
                              <PositionBadge pos={player.pos} className="h-4 text-[9px]" />
                            </span>
                          </span>
                        </button>
                        <Link
                          to="/trade"
                          className="ml-auto flex-shrink-0 text-[11px] font-black uppercase tracking-wide text-blue-600 transition-colors hover:text-blue-700"
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
  section,
  valueTrend,
  projPts,
  onOpenPlayer,
  showIrBadge = false,
}: {
  row: MatrixRow;
  section: RosterSection;
  valueTrend: string;
  projPts: string;
  onOpenPlayer: (id: string) => void;
  showIrBadge?: boolean;
}) {
  const player = row.player;
  const label = badgeLabelForRow(row, section);

  if (!player) {
    return (
      <div className="flex w-full cursor-default items-center justify-between px-3 py-3 text-left select-none">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex w-12 shrink-0 justify-start">
            <PositionBadge pos={label} />
          </span>
          <span className="text-sm text-slate-400">Empty slot</span>
        </div>
        <div className="flex shrink-0 items-center space-x-12 pr-1 text-sm font-medium tabular-nums select-none">
          <span className="w-28 text-right text-slate-300">—</span>
          <span className="w-12 text-right text-slate-300">—</span>
        </div>
      </div>
    );
  }

  const byeLabel =
    player.bye != null && player.bye > 0
      ? `${player.team?.trim() || "FA"} · Bye ${player.bye}`
      : player.team?.trim() || "FA";

  return (
    <button
      type="button"
      onClick={() => onOpenPlayer(player.id)}
      className="flex w-full cursor-pointer items-center justify-between px-3 py-3 text-left transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 select-none"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex w-12 shrink-0 justify-start">
          <PositionBadge pos={label} />
        </span>

        <span className="flex min-w-0 items-center gap-3">
          <PlayerAvatar
            id={player.id}
            pos={player.pos}
            team={player.team}
            name={player.name}
            className="size-10 flex-shrink-0"
            logoClassName="size-3.5"
          />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-semibold text-slate-900">{player.name}</span>
              <RosterInjuryBadge player={player} forceIr={showIrBadge} />
            </span>
            <span className="mt-0.5 block truncate text-[11px] font-medium uppercase text-slate-400">
              {byeLabel}
            </span>
          </span>
        </span>
      </div>

      <div className="flex shrink-0 items-center space-x-12 pr-1 text-sm font-medium tabular-nums select-none">
        <span className="w-28 whitespace-nowrap text-right text-slate-500">{valueTrend}</span>
        <span className="w-12 text-right font-semibold text-slate-800">{projPts}</span>
      </div>
    </button>
  );
}
