import { Columns2, Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { InjuryAvatarBadge } from "@/components/injury/InjuryAvatarBadge";
import { MobileFullScreenPicker } from "@/components/mobile/league/MobileTransactionModals";
import { HEX_CLIP, shortName } from "@/components/mobile/league/lineupShared";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Player } from "@/lib/players-build";
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

/** Opaque card + roster tint (rgba alone would leak scrolled text under sticky cols). */
function pickerRowClass(kind: RowKind, extra?: string) {
  return cn(
    "border-b border-m-border bg-m-card last:border-0",
    kind === "mine" &&
      "[background-image:linear-gradient(var(--m-highlight),var(--m-highlight))]",
    // Warm tint for other managers — distinct from your accent highlight.
    kind === "other" &&
      "[background-image:linear-gradient(rgba(240,138,36,0.12),rgba(240,138,36,0.12))]",
    extra,
  );
}

function rowKind(id: string, myIds: Set<string>, rosteredIds: Set<string>): RowKind {
  if (myIds.has(id)) return "mine";
  if (rosteredIds.has(id)) return "other";
  return "fa";
}

/**
 * Full-screen picker for Compare — Players-list chrome with a compare icon
 * instead of add/drop/trade. Defaults to the anchor player's position; the
 * user's rostered players at that position sort first.
 */
export function MobileComparePicker({
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

  return (
    <MobileFullScreenPicker
      title="Compare with"
      subtitle={
        <span>
          vs{" "}
          <span className="font-semibold text-m-card-fg">{shortName(anchorPlayer)}</span>
          {" · "}
          cross-position OK · same pos + your roster first
        </span>
      }
      onClose={onClose}
    >
      <div className="space-y-3">
        <div className="space-y-3 px-0.5">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-m-muted" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search players"
              className="w-full rounded-xl border border-m-border bg-m-card py-3 pl-10 pr-3 text-sm text-m-card-fg outline-none placeholder:text-m-muted focus:border-m-accent"
            />
          </label>

          <div className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]">
            {POS_CHIPS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setPos(c.id)}
                className={cn(
                  "shrink-0 rounded-full border px-3.5 py-1.5 font-display text-xs font-bold tracking-wide",
                  pos === c.id
                    ? "border-m-tab-active bg-m-tab-active text-m-tab-active-fg"
                    : "border-m-border bg-m-select-bg text-m-select-fg",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]">
            {OWNERSHIP_CHIPS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setOwnership(c.id)}
                className={cn(
                  "shrink-0 rounded-full border px-3.5 py-1.5 font-display text-xs font-bold tracking-wide",
                  ownership === c.id
                    ? "border-m-tab-active bg-m-tab-active text-m-tab-active-fg"
                    : "border-m-border bg-m-select-bg text-m-select-fg",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Bleed past the picker content padding so the board is edge-to-edge. */}
        <div className="-mx-2.5">
          {playersLoading ? (
            <p className="px-5 py-10 text-center text-sm text-m-muted">Loading players...</p>
          ) : rows.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-m-muted">No players match.</p>
          ) : (
            <ComparePickerTable
              rows={rows.slice(0, 80)}
              cols={cols}
              myIds={myIds}
              rosteredIds={rosteredIds}
              ownerByPlayerId={ownerByPlayerId}
              rankFor={rankFor}
              onSelect={onSelect}
            />
          )}
        </div>
      </div>
    </MobileFullScreenPicker>
  );
}

/**
 * Identity column is outside the horizontal scroller so Season/Avg/Pos Rnk
 * clip at the divider instead of sliding over player names.
 */
function ComparePickerTable({
  rows,
  cols,
  myIds,
  rosteredIds,
  ownerByPlayerId,
  rankFor,
  onSelect,
}: {
  rows: Player[];
  cols: Col[];
  myIds: Set<string>;
  rosteredIds: Set<string>;
  ownerByPlayerId: Map<string, string>;
  rankFor: (id: string) => { pos?: number | null };
  onSelect: (player: Player) => void;
}) {
  return (
    <div className="flex border-y border-m-border bg-m-card">
      <div className="relative z-10 w-[230px] shrink-0 border-r border-m-border bg-m-card shadow-[4px_0_10px_-4px_rgba(0,0,0,0.14)]">
        <div className="h-10 border-b border-m-border bg-m-card" aria-hidden />
        {rows.map((p) => {
          const kind = rowKind(p.id, myIds, rosteredIds);
          const owner = ownerByPlayerId.get(p.id);
          return (
            <div
              key={p.id}
              className={pickerRowClass(kind, "flex h-[68px] items-center gap-2.5 px-2.5")}
            >
              <button
                type="button"
                aria-label={`Compare with ${shortName(p)}`}
                onClick={() => onSelect(p)}
                className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-m-accent text-m-accent-fg shadow-[inset_0_-3px_0_rgba(0,0,0,0.18)]"
              >
                <Columns2 className="size-5" strokeWidth={2.5} />
              </button>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                onClick={() => onSelect(p)}
              >
                <div className="relative shrink-0">
                  <PlayerAvatar
                    id={p.id}
                    pos={p.pos}
                    team={p.team}
                    name={p.name}
                    className="size-11"
                    logoClassName="hidden"
                  />
                  {(() => {
                    const r = rankFor(p.id).pos;
                    if (r == null || r <= 0 || r >= 900) return null;
                    return (
                      <span
                        className="absolute -left-1.5 -top-1.5 flex size-6 items-center justify-center bg-m-pos-rank-bg font-display text-[11px] font-bold text-m-pos-rank-fg shadow-[0_0_0_1px_rgba(0,0,0,0.08)]"
                        style={{ clipPath: HEX_CLIP }}
                      >
                        {r}
                      </span>
                    );
                  })()}
                  <InjuryAvatarBadge status={p.injury_status ?? p.injury} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold leading-tight">{shortName(p)}</p>
                  <p className="truncate text-xs text-m-muted">
                    {p.team || "FA"} - {p.pos === "DEF" ? "DST" : p.pos}
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

      <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none]">
        <div className="min-w-max">
          <div className="flex h-10 border-b border-m-border text-[11px] font-semibold uppercase tracking-wide text-m-muted">
            {cols.map((c) => (
              <div key={c.key} className="flex w-[84px] items-center justify-end px-3">
                {c.label}
              </div>
            ))}
          </div>
          {rows.map((p) => {
            const kind = rowKind(p.id, myIds, rosteredIds);
            return (
              <div key={p.id} className={pickerRowClass(kind, "flex h-[68px] items-center")}>
                {cols.map((c) => {
                  const v = c.value(p);
                  return (
                    <div
                      key={c.key}
                      className="flex w-[84px] items-center justify-end px-3 text-[15px] tabnum"
                    >
                      {v == null ? "-" : v.toFixed(c.decimals)}
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
