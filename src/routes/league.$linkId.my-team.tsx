import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import {
  FantasyBoard,
  FantasySectionTitle,
  fantasyOutlineBtn,
  fantasyPrimaryBtn,
} from "@/components/native/fantasy";
import { Toaster } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import {
  buildDefaultLineupSlots,
  classifyIrStatus,
  parseRosterSlotCounts,
  playerEligibleForIr,
  slotsRecordFromViews,
  viewsFromSlotsRecord,
  type NativeLineupSlotView,
} from "@/lib/native-league-lineup";
import {
  getNativeLeagueBoard,
  getNativeLineup,
  getNativeStandings,
  resolveNativeIrViolation,
  saveNativeLineup,
} from "@/lib/native-league.functions";
import { DEFAULT_IR_ALLOWED_STATUSES } from "@/lib/native-league-settings";
import { loadPlayersCatalog } from "@/lib/players-catalog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/league/$linkId/my-team")({
  ssr: false,
  component: NativeMyTeamPage,
});

const dangerOutlineClass =
  "rounded-md border border-red-300 bg-white px-3 py-1.5 font-display text-xs uppercase tracking-wide text-red-700 disabled:opacity-60";

const QUICK_LINKS = [
  { label: "Matchup", to: "/league/$linkId/matchup" as const },
  { label: "Players", to: "/league/$linkId/players" as const },
  { label: "Waivers", to: "/league/$linkId/waivers" as const },
  { label: "Trades", to: "/league/$linkId/trades" as const },
];

function NativeMyTeamPage() {
  const { linkId } = Route.useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const modalRef = useRef<PlayerModalHandle>(null);
  const cache = useSleeperPlayers();
  const fallback = useQuery({
    queryKey: ["players-catalog"],
    queryFn: () => loadPlayersCatalog(),
    enabled: Boolean(cache.error) && !cache.data,
    staleTime: 1000 * 60 * 30,
  });
  const players = cache.data?.players ?? fallback.data?.players ?? [];
  const posById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of players) map[p.id] = p.pos;
    return map;
  }, [players]);
  const injuryById = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const p of players) map[p.id] = p.injury_status ?? p.injury ?? null;
    return map;
  }, [players]);
  const teamByPlayerId = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const p of players) map[p.id] = p.team || null;
    return map;
  }, [players]);
  const nameById = useMemo(() => {
    const map = new Map<string, { name: string; pos: string; team: string }>();
    for (const p of players) map.set(p.id, { name: p.name, pos: p.pos, team: p.team });
    return map;
  }, [players]);

  const { data: board } = useQuery({
    queryKey: ["native-league-board", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 60_000,
    queryFn: () => getNativeLeagueBoard({ data: { linkId } }),
  });

  const { data: standings } = useQuery({
    queryKey: ["native-standings", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 30_000,
    queryFn: () => getNativeStandings({ data: { linkId } }),
  });

  const { data: lineup, isLoading } = useQuery({
    queryKey: ["native-lineup", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 15_000,
    retry: false,
    queryFn: () => getNativeLineup({ data: { linkId } }),
  });

  const [views, setViews] = useState<NativeLineupSlotView[]>([]);
  const [version, setVersion] = useState(0);
  const [rosterVersion, setRosterVersion] = useState(1);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [activateDropFor, setActivateDropFor] = useState<string | null>(null);
  const [dropPick, setDropPick] = useState("");

  const allowedStatuses = useMemo(
    () =>
      lineup?.irAllowedStatuses?.length
        ? lineup.irAllowedStatuses
        : DEFAULT_IR_ALLOWED_STATUSES,
    [lineup?.irAllowedStatuses],
  );

  useEffect(() => {
    if (!lineup) return;
    const counts = parseRosterSlotCounts(lineup.rosterSlots);
    if (lineup.slots) {
      setViews(viewsFromSlotsRecord(counts, lineup.slots));
      setDirty(false);
    } else if (lineup.rosterPlayerIds.length > 0 && Object.keys(posById).length > 0) {
      const defaults = buildDefaultLineupSlots(lineup.rosterPlayerIds, posById, counts, {
        injuryById,
        irAllowedStatuses: allowedStatuses,
      });
      setViews(viewsFromSlotsRecord(counts, defaults));
      setDirty(true);
    } else {
      setViews(viewsFromSlotsRecord(counts, {}));
      setDirty(false);
    }
    setVersion(lineup.version);
    setRosterVersion(lineup.rosterVersion);
    setSelectedKey(null);
    setActivateDropFor(null);
    setDropPick("");
  }, [lineup, posById, injuryById, allowedStatuses]);

  const ineligibleIr = useMemo(() => {
    const ids = lineup?.irPlayerIds ?? [];
    return ids
      .filter((id) => !playerEligibleForIr(injuryById[id], allowedStatuses))
      .map((playerId) => ({
        playerId,
        injury: injuryById[playerId] ?? null,
      }));
  }, [lineup?.irPlayerIds, injuryById, allowedStatuses]);
  const hasIrViolations = ineligibleIr.length > 0;
  const activeFull =
    (lineup?.activePlayerIds.length ?? 0) >= (lineup?.rosterCapacity ?? 0);

  const selectedIndex = views.findIndex((v) => `${v.key}:${v.index}` === selectedKey);

  const myStanding = useMemo(() => {
    if (!standings?.standings?.length) return null;
    const teamId = lineup?.teamId ?? board?.summary.teamId;
    if (teamId == null) return null;
    return standings.standings.find((r) => r.teamId === teamId) ?? null;
  }, [standings?.standings, lineup?.teamId, board?.summary.teamId]);

  const onSlotClick = (row: NativeLineupSlotView) => {
    if (!lineup?.canEdit || hasIrViolations) return;
    const key = `${row.key}:${row.index}`;
    if (selectedKey == null) {
      if (!row.playerId) return;
      setSelectedKey(key);
      return;
    }
    if (selectedKey === key) {
      setSelectedKey(null);
      return;
    }
    const from = selectedIndex;
    const to = views.findIndex((v) => `${v.key}:${v.index}` === key);
    if (from < 0 || to < 0) {
      setSelectedKey(null);
      return;
    }
    setViews((prev) => {
      const next = prev.map((v) => ({ ...v }));
      const a = next[from]!;
      const b = next[to]!;
      const tmp = a.playerId;
      a.playerId = b.playerId;
      b.playerId = tmp;
      return next;
    });
    setDirty(true);
    setSelectedKey(null);
  };

  const refreshLineup = async () => {
    await queryClient.invalidateQueries({ queryKey: ["native-lineup", linkId] });
    await queryClient.invalidateQueries({ queryKey: ["native-league-board", linkId] });
  };

  const resolveIr = async (
    playerId: string,
    action: "drop" | "activate",
    dropPlayerId?: string | null,
  ) => {
    if (!lineup?.canEdit || resolvingId) return;
    setResolvingId(playerId);
    try {
      const result = await resolveNativeIrViolation({
        data: {
          linkId,
          playerId,
          action,
          dropPlayerId: dropPlayerId ?? null,
          rosterVersion,
        },
      });
      if (!result.ok) {
        if (result.requiresDrop) {
          setActivateDropFor(playerId);
          toast.error(result.error);
        } else {
          toast.error(result.error);
        }
        return;
      }
      if (result.rosterVersion != null) setRosterVersion(result.rosterVersion);
      setActivateDropFor(null);
      setDropPick("");
      toast.success(action === "drop" ? "Player dropped from IR." : "Player moved off IR.");
      await refreshLineup();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resolve IR status.");
    } finally {
      setResolvingId(null);
    }
  };

  const save = async () => {
    if (!lineup?.canEdit || saving || hasIrViolations) return;
    setSaving(true);
    try {
      const result = await saveNativeLineup({
        data: {
          linkId,
          week: lineup.week,
          version,
          slots: slotsRecordFromViews(views),
          posById,
          injuryById,
          teamByPlayerId,
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.version != null) setVersion(result.version);
      setDirty(false);
      toast.success("Lineup saved.");
      await queryClient.invalidateQueries({ queryKey: ["native-lineup", linkId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save lineup.");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading lineup…</p>;
  }

  if (!lineup) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-600">
          No team seat is linked to your account in this league. Claim a seat from Teams or join with
          an invite code.
        </p>
        <Link
          to="/league/$linkId/teams"
          params={{ linkId }}
          className={`${fantasyOutlineBtn} mt-4 inline-flex`}
        >
          Open Teams
        </Link>
      </div>
    );
  }

  const starters = views.filter((v) => v.starter);
  const reserves = views.filter((v) => !v.starter);
  const dropCandidates = views
    .filter((v) => v.key !== "IR" && v.playerId && v.playerId !== activateDropFor)
    .map((v) => v.playerId!)
    .filter((id, i, arr) => arr.indexOf(id) === i);

  const recordLabel =
    myStanding != null
      ? `${myStanding.wins}-${myStanding.losses}${myStanding.ties ? `-${myStanding.ties}` : ""}`
      : null;

  return (
    <div className="space-y-5">
      <Toaster />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display-title text-3xl text-slate-900">
            My <span className="text-primary">Team</span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Week {lineup.week ?? board?.currentWeek ?? "—"}
            {!lineup.draftComplete
              ? " · Lineups unlock after the draft is complete"
              : hasIrViolations
                ? " · IR action required"
                : dirty
                  ? " · Unsaved changes"
                  : ""}
          </p>
        </div>
        <button
          type="button"
          className={fantasyPrimaryBtn}
          disabled={!lineup.canEdit || saving || !dirty || hasIrViolations}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save Lineup"}
        </button>
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Team quick links">
        {QUICK_LINKS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            params={{ linkId }}
            className={fantasyOutlineBtn}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <section className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your roster</p>
        <p className="mt-1 font-display text-2xl font-semibold uppercase tracking-wide text-slate-900">
          {lineup.teamName}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {recordLabel ? `Record ${recordLabel}` : "Record updates after scored weeks"}
          {myStanding != null ? ` · ${myStanding.pointsFor.toFixed(1)} PF` : ""}
        </p>
      </section>

      {!lineup.draftComplete ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          Finish the draft first, then set your weekly lineup here.
          <div className="mt-3">
            <Link to="/league/$linkId/draft" params={{ linkId }} className={fantasyOutlineBtn}>
              Open Draft
            </Link>
          </div>
        </div>
      ) : (
        <>
          {hasIrViolations ? (
            <section className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm">
              <FantasySectionTitle className="text-red-800">IR action required</FantasySectionTitle>
              <p className="mt-1 text-sm text-red-900/80">
                These players no longer match the commissioner IR tags (
                {allowedStatuses.join(", ")}). Drop them, or move them off IR
                {activeFull ? " by dropping someone else from your active roster" : ""}.
              </p>
              <ul className="mt-3 space-y-3">
                {ineligibleIr.map((row) => {
                  const meta = nameById.get(row.playerId);
                  const tag = classifyIrStatus(row.injury) ?? row.injury ?? "Healthy";
                  const busy = resolvingId === row.playerId;
                  const pickingDrop = activateDropFor === row.playerId;
                  return (
                    <li
                      key={row.playerId}
                      className="rounded-lg border border-red-200 bg-white px-3 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <button
                            type="button"
                            className="font-medium text-slate-900 hover:text-primary hover:underline"
                            onClick={() => modalRef.current?.open(row.playerId)}
                          >
                            {meta?.name ?? row.playerId}
                          </button>
                          <p className="text-xs text-muted-foreground">
                            {(meta?.pos === "DEF" ? "DST" : meta?.pos) ?? "—"} · {meta?.team || "—"} ·
                            Status: {tag}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={dangerOutlineClass}
                            disabled={busy || !!resolvingId}
                            onClick={() => void resolveIr(row.playerId, "drop")}
                          >
                            {busy ? "…" : "Drop player"}
                          </button>
                          <button
                            type="button"
                            className={fantasyOutlineBtn}
                            disabled={busy || !!resolvingId}
                            onClick={() => {
                              if (activeFull) {
                                setActivateDropFor(row.playerId);
                                setDropPick("");
                              } else {
                                void resolveIr(row.playerId, "activate");
                              }
                            }}
                          >
                            Move off IR
                          </button>
                        </div>
                      </div>
                      {pickingDrop ? (
                        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                          <p className="text-xs text-slate-600">
                            Active roster is full. Choose a player to drop so this IR player can be
                            activated.
                          </p>
                          <select
                            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                            value={dropPick}
                            onChange={(e) => setDropPick(e.target.value)}
                          >
                            <option value="">Select player to drop…</option>
                            {dropCandidates.map((id) => {
                              const m = nameById.get(id);
                              return (
                                <option key={id} value={id}>
                                  {m?.name ?? id}
                                  {m ? ` (${m.pos === "DEF" ? "DST" : m.pos})` : ""}
                                </option>
                              );
                            })}
                          </select>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className={fantasyPrimaryBtn}
                              disabled={!dropPick || busy}
                              onClick={() => void resolveIr(row.playerId, "activate", dropPick)}
                            >
                              Confirm activate
                            </button>
                            <button
                              type="button"
                              className={fantasyOutlineBtn}
                              disabled={busy}
                              onClick={() => {
                                setActivateDropFor(null);
                                setDropPick("");
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <p className="text-sm text-muted-foreground">
            {hasIrViolations
              ? "Resolve IR violations above before editing or saving your lineup."
              : "Click a player, then click another slot to swap. Empty slots can receive a selected player. Game-time locks ship with scoring."}
          </p>

          <LineupSection
            title="Starters"
            rows={starters}
            selectedKey={selectedKey}
            nameById={nameById}
            injuryById={injuryById}
            ineligibleIds={new Set(ineligibleIr.map((r) => r.playerId))}
            canEdit={lineup.canEdit && !hasIrViolations}
            onSlotClick={onSlotClick}
            onOpen={(id) => modalRef.current?.open(id)}
          />
          <LineupSection
            title="Bench / IR"
            rows={reserves}
            selectedKey={selectedKey}
            nameById={nameById}
            injuryById={injuryById}
            ineligibleIds={new Set(ineligibleIr.map((r) => r.playerId))}
            canEdit={lineup.canEdit && !hasIrViolations}
            onSlotClick={onSlotClick}
            onOpen={(id) => modalRef.current?.open(id)}
          />
        </>
      )}

      <PlayerModalHost ref={modalRef} />
    </div>
  );
}

function LineupSection({
  title,
  rows,
  selectedKey,
  nameById,
  injuryById,
  ineligibleIds,
  canEdit,
  onSlotClick,
  onOpen,
}: {
  title: string;
  rows: NativeLineupSlotView[];
  selectedKey: string | null;
  nameById: Map<string, { name: string; pos: string; team: string }>;
  injuryById: Record<string, string | null>;
  ineligibleIds: Set<string>;
  canEdit: boolean;
  onSlotClick: (row: NativeLineupSlotView) => void;
  onOpen: (id: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <FantasyBoard title={title} bodyClassName="divide-y divide-slate-100">
      <ul>
        {rows.map((row) => {
          const key = `${row.key}:${row.index}`;
          const meta = row.playerId ? nameById.get(row.playerId) : null;
          const selected = selectedKey === key;
          const violated = Boolean(row.playerId && ineligibleIds.has(row.playerId));
          const injury = row.playerId ? injuryById[row.playerId] : null;
          const posBadge = row.label;
          return (
            <li key={key}>
              <div
                className={cn(
                  "flex items-center gap-3 border-l-4 border-transparent px-4 py-3",
                  selected && "border-primary bg-primary/5",
                  !selected && violated && "border-red-400 bg-red-50",
                  !selected && !violated && "border-slate-200",
                  canEdit && !selected && "cursor-pointer hover:bg-slate-50",
                )}
                onClick={() => onSlotClick(row)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSlotClick(row);
                  }
                }}
                role={canEdit ? "button" : undefined}
                tabIndex={canEdit ? 0 : undefined}
              >
                <span
                  className={cn(
                    "flex h-8 w-12 shrink-0 items-center justify-center rounded-md border text-xs font-bold uppercase tracking-wide",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-slate-200 bg-slate-50 text-slate-600",
                  )}
                >
                  {posBadge}
                </span>
                {row.playerId && meta ? (
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(row.playerId!);
                    }}
                  >
                    <span className="block truncate font-medium text-slate-900 hover:text-primary hover:underline">
                      {meta.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {meta.pos === "DEF" ? "DST" : meta.pos} · {meta.team || "—"}
                      {injury ? ` · ${injury}` : ""}
                      {violated ? " · IR ineligible" : ""}
                    </span>
                  </button>
                ) : (
                  <span className="flex-1 text-sm text-muted-foreground">Empty slot</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </FantasyBoard>
  );
}
