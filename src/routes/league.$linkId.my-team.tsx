import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import { Toaster } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import {
  buildDefaultLineupSlots,
  parseRosterSlotCounts,
  slotsRecordFromViews,
  viewsFromSlotsRecord,
  type NativeLineupSlotView,
} from "@/lib/native-league-lineup";
import { getNativeLineup, saveNativeLineup } from "@/lib/native-league.functions";
import { loadPlayersCatalog } from "@/lib/players-catalog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/league/$linkId/my-team")({
  ssr: false,
  component: NativeMyTeamPage,
});

const buttonClass =
  "rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-60";
const outlineClass =
  "rounded-md border border-border bg-white px-4 py-2 font-display text-sm uppercase tracking-wide text-slate-800 disabled:opacity-60";

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
  const nameById = useMemo(() => {
    const map = new Map<string, { name: string; pos: string; team: string }>();
    for (const p of players) map.set(p.id, { name: p.name, pos: p.pos, team: p.team });
    return map;
  }, [players]);

  const { data: lineup, isLoading } = useQuery({
    queryKey: ["native-lineup", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 15_000,
    retry: false,
    queryFn: () => getNativeLineup({ data: { linkId } }),
  });

  const [views, setViews] = useState<NativeLineupSlotView[]>([]);
  const [version, setVersion] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!lineup) return;
    const counts = parseRosterSlotCounts(lineup.rosterSlots);
    if (lineup.slots) {
      setViews(viewsFromSlotsRecord(counts, lineup.slots));
      setDirty(false);
    } else if (lineup.rosterPlayerIds.length > 0 && Object.keys(posById).length > 0) {
      const defaults = buildDefaultLineupSlots(lineup.rosterPlayerIds, posById, counts, {
        injuryById,
        irEligibility: lineup.irEligibility,
      });
      setViews(viewsFromSlotsRecord(counts, defaults));
      setDirty(true);
    } else {
      setViews(viewsFromSlotsRecord(counts, {}));
      setDirty(false);
    }
    setVersion(lineup.version);
    setSelectedKey(null);
  }, [lineup, posById, injuryById]);

  const selectedIndex = views.findIndex((v) => `${v.key}:${v.index}` === selectedKey);

  const onSlotClick = (row: NativeLineupSlotView) => {
    if (!lineup?.canEdit) return;
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

  const save = async () => {
    if (!lineup?.canEdit || saving) return;
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
        <Link to="/league/$linkId/teams" params={{ linkId }} className={`${outlineClass} mt-4 inline-flex`}>
          Open Teams
        </Link>
      </div>
    );
  }

  const starters = views.filter((v) => v.starter);
  const reserves = views.filter((v) => !v.starter);

  return (
    <div className="space-y-4">
      <Toaster />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display-title text-2xl text-slate-900">
            My <span className="text-primary">Team</span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {lineup.teamName} · Week {lineup.week}
            {!lineup.draftComplete
              ? " · Lineups unlock after the draft is complete"
              : dirty
                ? " · Unsaved changes"
                : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={!lineup.canEdit || saving || !dirty}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save Lineup"}
          </button>
        </div>
      </div>

      {!lineup.draftComplete ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          Finish the draft first, then set your weekly lineup here.
          <div className="mt-3">
            <Link to="/league/$linkId/draft" params={{ linkId }} className={outlineClass}>
              Open Draft
            </Link>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Tap a player, then tap another slot to swap. Empty slots can receive a selected player.
            Game-time locks ship with scoring.
          </p>

          <LineupSection
            title="Starters"
            rows={starters}
            selectedKey={selectedKey}
            nameById={nameById}
            canEdit={lineup.canEdit}
            onSlotClick={onSlotClick}
            onOpen={(id) => modalRef.current?.open(id)}
          />
          <LineupSection
            title="Bench / IR"
            rows={reserves}
            selectedKey={selectedKey}
            nameById={nameById}
            canEdit={lineup.canEdit}
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
  canEdit,
  onSlotClick,
  onOpen,
}: {
  title: string;
  rows: NativeLineupSlotView[];
  selectedKey: string | null;
  nameById: Map<string, { name: string; pos: string; team: string }>;
  canEdit: boolean;
  onSlotClick: (row: NativeLineupSlotView) => void;
  onOpen: (id: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-900">{title}</h3>
      </div>
      <ul className="divide-y divide-slate-100">
        {rows.map((row) => {
          const key = `${row.key}:${row.index}`;
          const meta = row.playerId ? nameById.get(row.playerId) : null;
          const selected = selectedKey === key;
          return (
            <li key={key}>
              <div
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5",
                  selected && "bg-blue-50",
                  canEdit && "cursor-pointer hover:bg-slate-50",
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
                <span className="w-14 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {row.label}
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
                    </span>
                  </button>
                ) : (
                  <span className="flex-1 text-sm text-muted-foreground">Empty</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
