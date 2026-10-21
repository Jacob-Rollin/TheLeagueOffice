import { Columns2, Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { DesktopRosterPicker } from "@/components/native/fantasy/NativeTransactionDialogs";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Player } from "@/lib/players-build";
import { injuryMicroBadge, resolveInjuryStatus } from "@/lib/sandbox-rosters";
import { projectionPoints } from "@/lib/scoring-map";
import { cn } from "@/lib/utils";

type PosFilter = "ALL" | "QB" | "RB" | "WR" | "TE" | "FLEX" | "K" | "DEF";
type OwnershipFilter = "all" | "available" | "rostered";

const POS_CHIPS: { id: PosFilter; label: string }[] = [
  { id: "ALL", label: "ALL" },
  { id: "QB", label: "QB" },
  { id: "RB", label: "RB" },
  { id: "WR", label: "WR" },
  { id: "TE", label: "TE" },
  { id: "FLEX", label: "R/W/T" },
  { id: "K", label: "K" },
  { id: "DEF", label: "DST" },
];

const OWNERSHIP_CHIPS: { id: OwnershipFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "available", label: "Available" },
  { id: "rostered", label: "Rostered" },
];

const FLEX_POS = new Set(["RB", "WR", "TE"]);

const matchesPos = (p: Player, pos: PosFilter) =>
  pos === "ALL" || (pos === "FLEX" ? FLEX_POS.has(p.pos) : p.pos === pos);

function toPosFilter(pos: string | null | undefined): PosFilter {
  const p = String(pos ?? "").toUpperCase();
  if (p === "DST" || p === "D/ST") return "DEF";
  if (p === "QB" || p === "RB" || p === "WR" || p === "TE" || p === "K" || p === "DEF") {
    return p;
  }
  return "ALL";
}

type Col = { key: string; label: string; value: (p: Player) => number | null; decimals: number };

type RowKind = "mine" | "other" | "fa";

function pickerRowClass(kind: RowKind, extra?: string) {
  return cn(
    "border-b border-slate-100 bg-white last:border-0",
    kind === "mine" && "bg-sky-50/90",
    kind === "other" && "bg-white",
    kind === "fa" && "bg-emerald-50/40",
    extra,
  );
}

function rowKind(id: string, myIds: Set<string>, rosteredIds: Set<string>): RowKind {
  if (myIds.has(id)) return "mine";
  if (rosteredIds.has(id)) return "other";
  return "fa";
}

function CompareRowInjuryBadge({ status }: { status?: string | null }) {
  const badge = injuryMicroBadge(status);
  if (!badge) return null;
  return (
    <span
      className={cn(
        "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[2px] px-0.5 text-[9px] font-bold text-white",
        badge.className,
      )}
    >
      {badge.label}
    </span>
  );
}

/**
 * Desktop Broadcast picker for Compare — player column matches draft/research
 * list chrome (name + injury chip, meta line); centered player-sized modal.
 */
export function DesktopComparePicker({
  anchorPlayer,
  excludeId,
  onSelect,
  onClose,
}: {
  anchorPlayer: Player;
  excludeId?: string | null;
  onSelect: (player: Player) => void;
  onClose: () => void;
}) {
  const { data: playersPayload, loading: playersLoading } = useSleeperPlayers();
  const players = useMemo(() => playersPayload?.players ?? [], [playersPayload]);
  const { myTeam, rosteredIds, ownerByPlayerId } = useLeagueRosters(players);
  const myIds = useMemo(() => new Set((myTeam?.players ?? []).map((p) => p.id)), [myTeam]);

  const [pos, setPos] = useState<PosFilter>(() => toPosFilter(anchorPlayer.pos));
  const [ownership, setOwnership] = useState<OwnershipFilter>("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  const { seasonStats, scoringMap, format, rankFor } = useLeagueProjections();

  const scored = (id: string) =>
    projectionPoints(seasonStats?.get(id)?.stats, scoringMap, format);

  const cols: Col[] = useMemo(
    () => [
      {
        key: "season",
        label: "Season",
        value: (p) => scored(p.id),
        decimals: 1,
      },
      {
        key: "avg",
        label: "Avg",
        value: (p) => {
          const pts = scored(p.id);
          const gp = Number(seasonStats?.get(p.id)?.stats["gp"] ?? 0);
          return pts != null && gp > 0 ? pts / gp : null;
        },
        decimals: 1,
      },
      {
        key: "rank",
        label: "Pos Rnk",
        value: (p) => {
          const r = rankFor(p.id).pos;
          return r != null && r > 0 && r < 900 ? r : null;
        },
        decimals: 0,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seasonStats, scoringMap, format, rankFor],
  );

  const rows = useMemo(() => {
    const needle = deferredSearch.trim().toLowerCase();
    const exclude = excludeId ?? anchorPlayer.id;
    const list = players.filter((p) => {
      if (p.id === exclude) return false;
      if (!matchesPos(p, pos)) return false;
      if (ownership === "available" && rosteredIds.has(p.id)) return false;
      if (ownership === "rostered" && !rosteredIds.has(p.id)) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        (p.team ?? "").toLowerCase().includes(needle) ||
        p.pos.toLowerCase().includes(needle)
      );
    });

    const tier = (p: Player) => {
      const mine = myIds.has(p.id);
      const samePos = p.pos === anchorPlayer.pos || (anchorPlayer.pos === "DEF" && p.pos === "DEF");
      if (mine && samePos) return 0;
      if (mine) return 1;
      if (rosteredIds.has(p.id) && samePos) return 2;
      if (samePos) return 3;
      return 4;
    };

    list.sort((a, b) => {
      const ta = tier(a);
      const tb = tier(b);
      if (ta !== tb) return ta - tb;
      const sa = scored(a.id) ?? -1;
      const sb = scored(b.id) ?? -1;
      if (sb !== sa) return sb - sa;
      return a.name.localeCompare(b.name);
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    players,
    deferredSearch,
    pos,
    ownership,
    excludeId,
    anchorPlayer.id,
    anchorPlayer.pos,
    myIds,
    rosteredIds,
    seasonStats,
  ]);

  const anchorLabel =
    anchorPlayer.pos === "DEF"
      ? (anchorPlayer.name.split(" ").at(-1) ?? anchorPlayer.name)
      : anchorPlayer.name;

  return (
    <DesktopRosterPicker
      title="Compare with"
      size="player"
      subtitle={
        <span>
          vs <span className="font-semibold text-slate-900">{anchorLabel}</span>
          {" · "}
          cross-position OK · same pos + your roster first
        </span>
      }
      onClose={onClose}
    >
      <div className="space-y-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search players"
            className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-600"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          {POS_CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setPos(c.id)}
              className={cn(
                "shrink-0 rounded-md border px-3 py-1.5 font-display text-xs font-bold tracking-wide",
                pos === c.id
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-blue-700 hover:border-blue-300",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {OWNERSHIP_CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setOwnership(c.id)}
              className={cn(
                "shrink-0 rounded-md border px-3 py-1.5 font-display text-xs font-bold tracking-wide",
                ownership === c.id
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-blue-700 hover:border-blue-300",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {playersLoading ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">Loading players...</p>
          ) : rows.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">No players match.</p>
          ) : (
            <ComparePickerTable
              rows={rows.slice(0, 100)}
              cols={cols}
              myIds={myIds}
              rosteredIds={rosteredIds}
              ownerByPlayerId={ownerByPlayerId}
              onSelect={onSelect}
            />
          )}
        </div>
      </div>
    </DesktopRosterPicker>
  );
}

function ComparePickerTable({
  rows,
  cols,
  myIds,
  rosteredIds,
  ownerByPlayerId,
  onSelect,
}: {
  rows: Player[];
  cols: Col[];
  myIds: Set<string>;
  rosteredIds: Set<string>;
  ownerByPlayerId: Map<string, string>;
  onSelect: (player: Player) => void;
}) {
  return (
    <div className="flex">
      <div className="relative z-10 w-[min(360px,46%)] shrink-0 border-r border-slate-200 bg-white shadow-[4px_0_10px_-4px_rgba(0,0,0,0.08)]">
        <div className="flex h-10 items-center border-b border-slate-200 bg-slate-50 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Player
        </div>
        {rows.map((p) => {
          const kind = rowKind(p.id, myIds, rosteredIds);
          const owner = ownerByPlayerId.get(p.id);
          const injury =
            resolveInjuryStatus(p) ?? p.injury_status ?? p.injury ?? null;
          const posLabel = p.pos === "DEF" ? "DST" : p.pos;
          return (
            <div
              key={p.id}
              className={pickerRowClass(kind, "flex h-[58px] items-center gap-2 px-2")}
            >
              <button
                type="button"
                aria-label={`Compare with ${p.name}`}
                onClick={() => onSelect(p)}
                className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm"
              >
                <Columns2 className="size-4" strokeWidth={2.5} />
              </button>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                onClick={() => onSelect(p)}
              >
                <PlayerAvatar
                  id={p.id}
                  pos={p.pos}
                  team={p.team}
                  name={p.name}
                  className="size-9 shrink-0 rounded-full border-2 border-slate-200 bg-white"
                  logoClassName="size-3"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-semibold text-blue-700">{p.name}</span>
                    <CompareRowInjuryBadge status={injury} />
                  </div>
                  <p className="mt-0.5 truncate text-[11px] font-medium uppercase text-slate-400">
                    {posLabel}
                    {p.team ? ` · ${p.team}` : ""}
                    {kind === "mine"
                      ? " · You"
                      : owner
                        ? ` · ${owner}`
                        : kind === "fa"
                          ? " · FA"
                          : ""}
                  </p>
                </div>
              </button>
            </div>
          );
        })}
      </div>

      <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="min-w-max">
          <div className="flex h-10 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {cols.map((c) => (
              <div key={c.key} className="flex w-24 items-center justify-end px-3">
                {c.label}
              </div>
            ))}
          </div>
          {rows.map((p) => {
            const kind = rowKind(p.id, myIds, rosteredIds);
            return (
              <div key={p.id} className={pickerRowClass(kind, "flex h-[58px] items-center")}>
                {cols.map((c) => {
                  const v = c.value(p);
                  return (
                    <div
                      key={c.key}
                      className="flex w-24 items-center justify-end px-3 text-sm tabular-nums text-slate-800"
                    >
                      {v == null ? "—" : c.decimals === 0 ? String(Math.round(v)) : v.toFixed(c.decimals)}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
