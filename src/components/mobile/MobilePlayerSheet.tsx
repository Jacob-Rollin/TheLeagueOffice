import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Columns2, Minus, Plus, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { playerImage, teamLogo } from "@/components/draft/PlayerAvatar";
import { MobileComparePicker } from "@/components/mobile/MobileComparePicker";
import { MobileCompareSheet } from "@/components/mobile/MobileCompareSheet";
import { useNativeRosterActions } from "@/components/mobile/league/nativeRosterActions";
import { useMobileLeagueActivity } from "@/components/mobile/league/useMobileLeague";
import { valueTrendTone } from "@/components/research/ValueTrendCell";
import { useLeagueProjections, useNflState } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useLiveInjuryStatuses } from "@/hooks/useLiveInjuryStatuses";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { usePlayerSos } from "@/hooks/usePlayerSos";
import { usePositionalDefenseRanks } from "@/hooks/usePositionalDefenseRanks";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import type { Pos } from "@/lib/draft";
import { injuryBadgeInfo, type InjuryBadgeInfo } from "@/lib/injury-badge";
import type { LeagueActivityEvent, LeagueActivityMove } from "@/lib/league.functions";
import {
  fetchNflTeamDepth,
  teamDepthFor,
  type TeamDepthEntry,
  type TeamDepthSlot,
} from "@/lib/nfl-team-depth";
import {
  fetchNflTeamOffenseRanks,
  teamOffenseRanksFor,
  teamRankChipsForPos,
} from "@/lib/nfl-team-offense-ranks";
import { teamFullName } from "@/lib/nfl-teams";
import { detailQuery } from "@/lib/player-detail-query";
import { fetchPlayerNewsClient } from "@/lib/player-news-client";
import type { Player } from "@/lib/players-build";
import { prefetchPlayerDetail } from "@/lib/prefetch-player-detail";
import { fetchResearchFpa } from "@/lib/research-cdn";
import { formatNflKickoffLabel } from "@/lib/rolling-live-projection";
import { resolveInjuryStatus } from "@/lib/sandbox-rosters";
import { projectionPoints } from "@/lib/scoring-map";
import { fetchSnapTradeMarket } from "@/lib/snap-cdn";
import {
  fetchGameLogsClient,
  fetchNextGameClient,
  fetchPlayerBioClient,
} from "@/lib/sleeper-client";
import { sosOppTextClass } from "@/lib/sos-presentation";
import { scaleValue } from "@/lib/trade-engine";
import { cn } from "@/lib/utils";

/**
 * Pointy-top hexagon path for the raised position-rank badge.
 * Prefer SVG fill+stroke over CSS clip-path + filter:drop-shadow — dual
 * drop-shadow on a clipped shape flickers on mobile scroll compositors
 * (left/right outline “blinks” away).
 */
const RANK_HEX_POINTS = "40,2 78,24 78,68 40,90 2,68 2,24";
const HOUR = 60 * 60 * 1000;

type OpenPlayer = (id: string) => void;
const MobilePlayerContext = createContext<OpenPlayer>(() => {});

/** Opens the mobile player popup for a Sleeper player id. */
export function useOpenMobilePlayer() {
  return useContext(MobilePlayerContext);
}

/** Props that make any element open the player popup on tap or Enter/Space. */
export function playerPressProps(open: OpenPlayer, id: string | null | undefined) {
  if (!id || id.startsWith("espn:")) return {};
  const warm = () => prefetchPlayerDetail(id);
  return {
    role: "button" as const,
    tabIndex: 0,
    // Warm on intent before the click/tap completes (mobile pointerdown is early).
    onPointerEnter: warm,
    onFocus: warm,
    onPointerDown: warm,
    onClick: () => open(id),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        warm();
        open(id);
      }
    },
  };
}

export function MobilePlayerSheetProvider({ children }: { children: ReactNode }) {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const open = useCallback((id: string) => {
    prefetchPlayerDetail(id);
    setPlayerId(id);
  }, []);
  const close = useCallback(() => setPlayerId(null), []);
  return (
    <MobilePlayerContext.Provider value={open}>
      {children}
      {playerId ? <MobilePlayerSheet id={playerId} onClose={close} /> : null}
    </MobilePlayerContext.Provider>
  );
}

const AVATAR_POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

type SheetTab = "overview" | "logs" | "team";

function compactPlayerName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0]!.toUpperCase();
  return `${parts[0]![0]!.toUpperCase()}. ${parts.slice(1).join(" ").toUpperCase()}`;
}

function MobilePlayerSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const [tab, setTab] = useState<SheetTab>("overview");
  const [compactHeader, setCompactHeader] = useState(false);
  /** Compare picker open (anchor = this sheet's player). */
  const [comparePickerOpen, setComparePickerOpen] = useState(false);
  /** Active compare pair — sheet portals above the player popup. */
  const [comparePair, setComparePair] = useState<{ leftId: string; rightId: string } | null>(
    null,
  );
  /** Which side to replace when reopening the picker from Compare. */
  const [compareReplaceSide, setCompareReplaceSide] = useState<"left" | "right" | null>(null);
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const heroSentinelRef = useRef<HTMLDivElement>(null);
  const openPlayer = useOpenMobilePlayer();
  // Reuses the league-rosters React Query cache — no catalog fetch required.
  const { ownerByPlayerId } = useLeagueRosters([]);
  const fantasyOwner = ownerByPlayerId.get(id) ?? null;
  const nativeActions = useNativeRosterActions();
  const { data: catalogPayload } = useSleeperPlayers();
  const catalogById = useMemo(() => {
    const m = new Map<string, Player>();
    for (const p of catalogPayload?.players ?? []) m.set(p.id, p);
    return m;
  }, [catalogPayload]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (comparePickerOpen) {
        setComparePickerOpen(false);
        setCompareReplaceSide(null);
        return;
      }
      if (comparePair) {
        setComparePair(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, comparePickerOpen, comparePair]);

  // Keep Team tab when hopping via depth chart; otherwise land on Overview.
  useEffect(() => {
    setTab((prev) => (prev === "team" ? "team" : "overview"));
    setCompactHeader(false);
    setComparePickerOpen(false);
    setCompareReplaceSide(null);
    // Keep an open compare sheet when hopping players from Team tab depth chart.
  }, [id]);

  // Same cache key as desktop PlayerDetail / hover prefetch.
  const detail = useQuery(detailQuery(id));
  const { data: bio } = useQuery({
    queryKey: ["player-bio", id],
    queryFn: () => fetchPlayerBioClient(id),
    staleTime: 12 * HOUR,
    retry: false,
  });
  const player = detail.data?.player ?? null;
  const team = player?.team && player.team !== "FA" ? player.team : null;
  const { data: nextGame } = useQuery({
    // v2: fantasy-week slate (Tuesday roll), not next calendar kickoff.
    queryKey: ["player-next-game", "v2-fantasy-week", team],
    enabled: Boolean(team),
    queryFn: () => fetchNextGameClient(team!),
    staleTime: HOUR,
    retry: false,
  });

  const { rankFor, projectFor, seasonStats, scoringMap, format } = useLeagueProjections(
    nextGame?.seasonType === "regular" ? nextGame.week : null,
  );

  const avgPts = useMemo(() => {
    const row = seasonStats?.get(id);
    const pts = projectionPoints(row?.stats, scoringMap, format);
    const gp = Number(row?.stats["gp"] ?? 0);
    return pts != null && gp > 0 ? pts / gp : null;
  }, [seasonStats, id, scoringMap, format]);

  const pos = (player?.pos ?? "WR") as Pos;
  const posRank = rankFor(id).pos;
  const ownership = player as
    | (typeof player & { rostered_pct?: number | null; rostered?: number | null; started_pct?: number | null; started?: number | null })
    | null;
  const ownedPct = ownership?.rostered_pct ?? ownership?.rostered ?? null;
  const startedPct = ownership?.started_pct ?? ownership?.started ?? null;

  const [first, ...rest] = (player?.name ?? "").split(" ");
  const injuryInfo = player ? injuryBadgeInfo(resolveInjuryStatus(player) ?? player.injury_status) : null;
  const logo = teamLogo(team);
  const image = player ? playerImage(player.id, AVATAR_POS.has(pos) ? pos : "WR", player.team) : null;

  // Compact overlay once the hero identity block leaves the sheet viewport.
  // Fixed overlay (not sticky-in-flow) so appearing does not shift scroll / shake.
  useEffect(() => {
    const root = scrollRootRef.current;
    const sentinel = heroSentinelRef.current;
    if (!root || !sentinel || !player) {
      setCompactHeader(false);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => setCompactHeader(!entry?.isIntersecting),
      { root, threshold: 0, rootMargin: "0px" },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [id, player]);

  return (
    <div
      ref={scrollRootRef}
      role="dialog"
      aria-modal="true"
      aria-label={player?.name ?? "Player"}
      className="fixed inset-0 z-50 overflow-y-auto bg-m-bg"
    >
      {/* Fixed overlay — does not consume document flow (avoids hero↔compact jump). */}
      {compactHeader && player ? (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center">
          <div className="pointer-events-auto flex w-full max-w-md items-center gap-2 border-b border-m-border bg-m-card/95 px-3 py-2.5 text-m-card-fg shadow-sm backdrop-blur-sm">
            {logo ? (
              <img src={logo} alt="" className="size-8 shrink-0 rounded-full bg-m-chip object-contain p-0.5" />
            ) : null}
            {/* Name + injury; Compare / roster actions live on the strip above tabs. */}
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <p className="min-w-0 truncate font-display text-[17px] font-bold tracking-wide">
                {compactPlayerName(player.name)}
              </p>
              {injuryInfo ? (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide",
                    injuryInfo.className,
                  )}
                >
                  {injuryInfo.text}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close player"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-m-icon-bg text-m-icon-fg"
            >
              <X className="size-4" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      ) : null}

      <div className="mx-auto w-full max-w-md pb-10">
        <section className="relative overflow-hidden bg-m-card text-m-card-fg">
          {/* Faded team mark: centered in the header, behind name + headshot. */}
          {logo ? (
            <img
              src={logo}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-[48%] z-0 size-[22rem] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain opacity-[0.1]"
            />
          ) : null}

          {detail.isLoading ? (
            <>
              {!compactHeader ? (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close player"
                  className="absolute right-3 top-3 z-20 inline-flex size-10 items-center justify-center rounded-full bg-m-icon-bg text-m-icon-fg"
                >
                  <X className="size-5" strokeWidth={2.5} />
                </button>
              ) : null}
              <p className="relative z-[1] px-5 py-24 text-center text-sm text-m-muted">Loading player...</p>
            </>
          ) : !player ? (
            <>
              {!compactHeader ? (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close player"
                  className="absolute right-3 top-3 z-20 inline-flex size-10 items-center justify-center rounded-full bg-m-icon-bg text-m-icon-fg"
                >
                  <X className="size-5" strokeWidth={2.5} />
                </button>
              ) : null}
              <p className="relative z-[1] px-5 py-24 text-center text-sm text-m-muted">Player details are unavailable.</p>
            </>
          ) : (
            <div className="relative z-[1]">
              {/* Injury strip / close only — Compare sits above the sheet tabs. */}
              {injuryInfo ? (
                <div className="relative">
                  <PlayerInjuryTopBar info={injuryInfo} />
                  {!compactHeader ? (
                    <button
                      type="button"
                      onClick={onClose}
                      aria-label="Close player"
                      className="absolute right-3 top-1/2 z-20 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-m-icon-bg text-m-icon-fg shadow-sm"
                    >
                      <X className="size-5" strokeWidth={2.5} />
                    </button>
                  ) : null}
                </div>
              ) : !compactHeader ? (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close player"
                  className="absolute right-3 top-3 z-20 inline-flex size-10 items-center justify-center rounded-full bg-m-icon-bg text-m-icon-fg"
                >
                  <X className="size-5" strokeWidth={2.5} />
                </button>
              ) : null}

              <div className="flex min-h-[220px] items-end">
                <div className="min-w-0 flex-1 py-6 pl-5 pr-2">
                  <h2 className="font-display text-[34px] font-bold leading-[1.02]">
                    {first}
                    {rest.length ? (
                      <>
                        <br />
                        {rest.join(" ")}
                      </>
                    ) : null}
                  </h2>
                  <div className="mt-3 flex items-center gap-2.5">
                    {logo ? (
                      <img src={logo} alt="" className="size-9 shrink-0 rounded-full bg-m-chip object-contain p-1" />
                    ) : null}
                    <div className="min-w-0 text-[13px] leading-tight">
                      <p className="truncate">{team ? teamFullName(team) : "Free Agent"}</p>
                      <p className="text-m-muted">
                        {player.pos}
                        {bio?.number != null ? ` • #${bio.number}` : ""}
                      </p>
                    </div>
                  </div>
                  {fantasyOwner ? (
                    <div className="mt-2.5 max-w-full">
                      <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-m-border bg-m-chip px-2.5 py-1 text-[12px] font-semibold text-m-chip-fg">
                        <span className="font-display text-[11px] font-bold uppercase tracking-wide text-m-accent">
                          On
                        </span>
                        <span className="truncate">{fantasyOwner}</span>
                      </span>
                    </div>
                  ) : null}
                </div>
                {image ? (
                  <img
                    src={image}
                    alt=""
                    className={cn(
                      "shrink-0 object-contain object-bottom",
                      pos === "DEF" ? "mb-6 mr-6 size-28" : "h-48 w-44 object-cover",
                    )}
                    onError={(e) => {
                      e.currentTarget.style.visibility = "hidden";
                    }}
                  />
                ) : null}
              </div>
            </div>
          )}
          {/* Sentinel at end of hero — compact overlays after this leaves the viewport. */}
          <div ref={heroSentinelRef} className="h-px w-full" aria-hidden="true" />
        </section>

        {player ? (
          <>
            <div className="relative grid grid-cols-5 items-center overflow-visible border-y border-m-border bg-m-card py-3 text-center text-m-card-fg">
              <StatCell label="Bye Wk" value={player.bye != null ? String(player.bye) : "-"} />
              <StatCell label="Avg Pts" value={avgPts != null ? avgPts.toFixed(2) : "-"} />
              <div className="relative z-10 flex justify-center self-stretch overflow-visible">
                <div className="pointer-events-none absolute -top-[38px] left-1/2 z-10 w-[80px] -translate-x-1/2">
                  <div className="relative h-[92px] w-[80px]">
                    <svg
                      viewBox="0 0 80 92"
                      className="absolute inset-0 size-full"
                      aria-hidden="true"
                    >
                      {/* Soft lift without filter:drop-shadow (avoids mobile edge flicker). */}
                      <polygon
                        points={RANK_HEX_POINTS}
                        className="fill-black/[0.14]"
                        transform="translate(0 2)"
                      />
                      <polygon
                        points={RANK_HEX_POINTS}
                        className="fill-m-card stroke-black/20"
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                    <div className="relative z-[1] flex h-full flex-col items-center justify-center px-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-m-muted">
                        {player.pos} Rnk
                      </span>
                      <span className="mt-0.5 font-display text-[34px] font-bold leading-none">
                        {posRank ?? "-"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <StatCell label="Own %" value={ownedPct != null ? `${Math.round(Number(ownedPct))}` : "-"} />
              <StatCell label="Start %" value={startedPct != null ? `${Math.round(Number(startedPct))}` : "-"} />
            </div>

            <PlayerActionStrip
              isNative={nativeActions.isNative}
              ownership={nativeActions.ownershipFor(id)}
              busy={nativeActions.busy}
              onCompare={() => {
                setCompareReplaceSide(null);
                setComparePickerOpen(true);
              }}
              onAdd={() => nativeActions.requestAdd(player)}
              onDrop={() => nativeActions.requestDrop(player)}
              onTradeFor={() => nativeActions.requestTradeFor(player)}
              onTradeAway={() => nativeActions.requestTradeAway(player)}
            />

            <div className="grid grid-cols-3 border-b border-m-border bg-m-card">
              {(
                [
                  ["overview", "Overview"],
                  ["logs", "Game Log"],
                  ["team", "Team"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={cn(
                    "border-b-4 py-3 font-display text-base font-semibold tracking-wide",
                    tab === key ? "border-m-accent text-m-card-fg" : "border-transparent text-m-muted",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "overview" ? (
              <Overview
                id={id}
                pos={player.pos}
                team={team}
                nextGame={nextGame ?? null}
                projected={projectFor(id)}
                sosGrade={detail.data?.sos?.grade ?? null}
                sosOpponents={detail.data?.sos?.opponents ?? null}
                format={format}
                injuryStatus={resolveInjuryStatus(player) ?? player.injury_status ?? null}
                injuryBodyPart={
                  (player as { injury_body_part?: string | null }).injury_body_part ?? null
                }
                injuryNotes={
                  (player as { injury_notes?: string | null }).injury_notes?.trim() || null
                }
              />
            ) : tab === "logs" ? (
              <GameLogTab
                id={id}
                team={team}
                pos={player.pos}
                format={format}
                exp={player.exp}
              />
            ) : (
              <TeamTab
                playerId={id}
                pos={player.pos}
                team={team}
                depthChart={detail.data?.depthChart ?? []}
                onSelectPlayer={openPlayer}
              />
            )}
          </>
        ) : null}
      </div>

      {comparePickerOpen && player ? (
        <MobileComparePicker
          anchorPlayer={
            compareReplaceSide === "right" && comparePair
              ? (catalogById.get(comparePair.leftId) ?? player)
              : compareReplaceSide === "left" && comparePair
                ? (catalogById.get(comparePair.rightId) ?? player)
                : player
          }
          excludeId={
            compareReplaceSide === "right" && comparePair
              ? comparePair.leftId
              : compareReplaceSide === "left" && comparePair
                ? comparePair.rightId
                : player.id
          }
          onClose={() => {
            setComparePickerOpen(false);
            setCompareReplaceSide(null);
          }}
          onSelect={(picked) => {
            if (compareReplaceSide === "left" && comparePair) {
              setComparePair({ leftId: picked.id, rightId: comparePair.rightId });
            } else if (compareReplaceSide === "right" && comparePair) {
              setComparePair({ leftId: comparePair.leftId, rightId: picked.id });
            } else {
              setComparePair({ leftId: id, rightId: picked.id });
            }
            setComparePickerOpen(false);
            setCompareReplaceSide(null);
          }}
        />
      ) : null}

      {comparePair ? (
        <MobileCompareSheet
          leftId={comparePair.leftId}
          rightId={comparePair.rightId}
          onClose={() => setComparePair(null)}
          onChangeSide={(side) => {
            setCompareReplaceSide(side);
            setComparePickerOpen(true);
          }}
        />
      ) : null}

      {nativeActions.isNative ? nativeActions.modals : null}
    </div>
  );
}

/**
 * Native leagues: ownership-aware Add/Drop/Trade + Compare.
 * Synced leagues: centered Compare only (mutations live on host platforms).
 */
function PlayerActionStrip({
  isNative,
  ownership,
  busy,
  onCompare,
  onAdd,
  onDrop,
  onTradeFor,
  onTradeAway,
}: {
  isNative: boolean;
  ownership: "mine" | "fa" | "other";
  busy: boolean;
  onCompare: () => void;
  onAdd: () => void;
  onDrop: () => void;
  onTradeFor: () => void;
  onTradeAway: () => void;
}) {
  const stripBtn =
    "inline-flex items-center justify-center gap-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.1em] disabled:opacity-50";

  if (!isNative) {
    return (
      <button
        type="button"
        onClick={onCompare}
        className={cn(
          stripBtn,
          "w-full border-b border-m-border bg-m-row-alt/70 py-1.5 text-m-accent",
        )}
      >
        <Columns2 className="size-3.5" strokeWidth={2.25} />
        Compare
      </button>
    );
  }

  if (ownership === "mine") {
    return (
      <div className="grid grid-cols-3 border-b border-m-border bg-m-row-alt/70 py-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={onDrop}
          className={cn(stripBtn, "text-[#e8551f]")}
        >
          <Minus className="size-3.5" strokeWidth={2.25} />
          Drop
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onTradeAway}
          className={cn(stripBtn, "text-[#f08a24]")}
        >
          <ArrowLeftRight className="size-3.5" strokeWidth={2.25} />
          Trade
        </button>
        <button type="button" onClick={onCompare} className={cn(stripBtn, "text-m-accent")}>
          <Columns2 className="size-3.5" strokeWidth={2.25} />
          Compare
        </button>
      </div>
    );
  }

  // FA: Add + Compare · other roster: Trade + Compare — even edge/gap spacing.
  return (
    <div className="flex items-center justify-evenly border-b border-m-border bg-m-row-alt/70 px-4 py-1.5">
      {ownership === "fa" ? (
        <button
          type="button"
          disabled={busy}
          onClick={onAdd}
          className={cn(stripBtn, "min-w-[6.5rem] text-[#1fae5b]")}
        >
          <Plus className="size-3.5" strokeWidth={2.25} />
          Add
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={onTradeFor}
          className={cn(stripBtn, "min-w-[6.5rem] text-[#f08a24]")}
        >
          <ArrowLeftRight className="size-3.5" strokeWidth={2.25} />
          Trade
        </button>
      )}
      <button
        type="button"
        onClick={onCompare}
        className={cn(stripBtn, "min-w-[6.5rem] text-m-accent")}
      >
        <Columns2 className="size-3.5" strokeWidth={2.25} />
        Compare
      </button>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-m-muted">{label}</p>
      <p className="mt-0.5 font-display text-lg font-semibold tabnum">{value}</p>
    </div>
  );
}

/**
 * Full-bleed injury wash across the hero (Sleeper-style translucent bar).
 * Centered solid full designation badge (Out / Questionable / …); close overlays the right edge.
 */
function PlayerInjuryTopBar({ info }: { info: InjuryBadgeInfo }) {
  // Light wash so the hero still reads through — badge stays solid.
  const barFill = info.tone === "amber" ? "bg-amber-500/40" : "bg-rose-600/40";

  return (
    <div className={cn("relative w-full", barFill)}>
      {/* Symmetric padding — close is absolute, so do not add pr-* or the badge drifts left. */}
      <div className="relative z-[1] flex items-center justify-center px-4 py-2.5">
        <span
          className={cn(
            "rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wide",
            info.className,
          )}
        >
          {info.text}
        </span>
      </div>
    </div>
  );
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mx-2.5 mt-3 overflow-hidden rounded-xl bg-m-card text-m-card-fg shadow-[0_1px_3px_rgba(0,0,0,0.1)]">
      {title ? (
        <h3 className="px-4 pt-4 font-display text-lg font-bold uppercase tracking-[0.06em]">{title}</h3>
      ) : null}
      {children}
    </section>
  );
}

/**
 * Market Value / 30d Trend from FantasyCalc trade-market snap.
 * Both numbers use scaleValue so Trend is in the same units as Value
 * (raw FC deltas like 183 were reading as nonsense next to Value 15.4).
 */
function OverviewMarketRow({ id, format }: { id: string; format: Format }) {
  const brain = usePlayerBrain();
  const market = useQuery({
    // Same key as Trade Market Values — shared RQ cache, no extra download.
    queryKey: ["trade-market", format],
    staleTime: 60 * 60 * 1000,
    retry: 1,
    placeholderData: (prev) => prev,
    queryFn: () => fetchSnapTradeMarket(format),
  });
  const marketRow = market.data?.rows?.find((r) => r.id === id) ?? null;
  const brainEntry = brain?.[id] ?? null;

  const rawValue = Number(marketRow?.value ?? brainEntry?.value ?? 0) || 0;
  const rawTrend = Number(marketRow?.trend30 ?? brainEntry?.trend ?? 0) || 0;
  const value = scaleValue(rawValue);
  const trendAbs = scaleValue(Math.abs(rawTrend));
  if (value <= 0 && trendAbs <= 0) return null;

  const tone = valueTrendTone(rawTrend);
  const trendClass =
    tone === "up" ? "text-emerald-600" : tone === "down" ? "text-rose-600" : "text-m-muted";
  // % of value 30d ago (current − delta). Vs current value blows up when the
  // drop is larger than today's Value (e.g. ▼8.3 on Value 4.2 → −198%).
  const prior = rawValue - rawTrend;
  const pct =
    prior > 0 && Number.isFinite(rawTrend) && rawTrend !== 0
      ? (rawTrend / prior) * 100
      : null;

  return (
    <section className="mx-2.5 mt-3 overflow-hidden rounded-xl border border-m-border bg-m-card text-m-card-fg shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <div className="grid grid-cols-2 py-3 text-center">
        <div className="border-r border-m-border">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-m-muted">Value</p>
          <p className="mt-0.5 font-display text-lg font-semibold tabular-nums text-m-card-fg">
            {value > 0 ? value.toFixed(1) : "-"}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-m-muted">30d Trend</p>
          {tone === "flat" || trendAbs <= 0 ? (
            <p className="mt-0.5 font-display text-lg font-semibold text-m-muted">Flat</p>
          ) : (
            <div className="mt-0.5 flex items-baseline justify-center gap-1.5">
              <p className={cn("font-display text-lg font-semibold tabular-nums", trendClass)}>
                <span aria-hidden="true" className="mr-0.5 text-[13px]">
                  {tone === "up" ? "▲" : "▼"}
                </span>
                {trendAbs.toFixed(1)}
              </p>
              {pct != null ? (
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                    tone === "up"
                      ? "bg-emerald-500/15 text-emerald-700"
                      : "bg-rose-500/15 text-rose-700",
                  )}
                >
                  {pct > 0 ? "+" : ""}
                  {pct.toFixed(0)}%
                </span>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Injury callout — only when the player has a real designation (Q/O/IR/…).
 * Body part + Sleeper/injury-wire notes only; never generic Latest News copy.
 */
function OverviewInjuryNote({
  playerId,
  status,
  bodyPart,
  notes,
}: {
  playerId: string;
  status: string | null;
  bodyPart: string | null;
  notes: string | null;
}) {
  const badge = injuryBadgeInfo(status);
  const brain = usePlayerBrain();
  const brainEntry = brain?.[playerId] ?? null;

  // Injury-wire note only (same CDN path as Latest News) — not the first news headline.
  // Hooks must stay unconditional; gate the fetch + the card on designation.
  const { data: news } = useQuery({
    queryKey: ["player-news", playerId, "cdn-v2"],
    queryFn: () => fetchPlayerNewsClient(playerId),
    enabled: Boolean(playerId) && Boolean(badge),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  if (!badge) return null;

  const diagnosis =
    bodyPart?.trim() ||
    brainEntry?.injuryType?.trim() ||
    null;
  const sleeperNote =
    notes?.trim() ||
    brainEntry?.injuryNotes?.trim() ||
    null;
  const wireNote = news?.injury?.note?.trim() || null;
  // Prefer Sleeper / brain medical notes; wire injury.note only — never headlines.
  const note = sleeperNote || wireNote || null;

  const critical = badge.tone === "rose";
  const accentBorder = critical ? "border-l-rose-500" : "border-l-amber-400";
  const accentLabel = critical ? "text-rose-600" : "text-amber-600";

  return (
    <section
      className={cn(
        "mx-2.5 mt-3 overflow-hidden rounded-xl border border-m-border border-l-4 bg-m-card text-m-card-fg shadow-[0_1px_3px_rgba(0,0,0,0.08)]",
        accentBorder,
      )}
    >
      <div className="px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cn("font-display text-[11px] font-bold uppercase tracking-[0.1em]", accentLabel)}>
            Injury Report
          </p>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide",
              badge.className,
            )}
          >
            {badge.text}
          </span>
        </div>
        {diagnosis ? (
          <p className="mt-1.5 text-[15px] font-semibold capitalize leading-snug text-m-card-fg">
            {diagnosis}
          </p>
        ) : null}
        {note ? (
          <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-m-muted">{note}</p>
        ) : (
          <p className="mt-1 text-[13px] leading-relaxed text-m-muted">
            Listed {badge.text.toLowerCase()}
            {diagnosis ? ` (${diagnosis})` : ""} — check Latest News before lock.
          </p>
        )}
      </div>
    </section>
  );
}

function rankTone(rank: number | null) {
  if (rank == null) return "";
  if (rank <= 10) return "text-red-500";
  if (rank >= 23) return "text-emerald-500";
  return "text-amber-500";
}

type Format = "std" | "half" | "ppr";

function Overview({
  id,
  pos,
  team,
  nextGame,
  projected,
  sosGrade,
  sosOpponents,
  format,
  injuryStatus,
  injuryBodyPart,
  injuryNotes,
}: {
  id: string;
  pos: string;
  team: string | null;
  nextGame: Awaited<ReturnType<typeof fetchNextGameClient>> | null;
  projected: number | null;
  sosGrade: string | null;
  sosOpponents: Array<{ week: number; opp: string; rank: number | null }> | null;
  format: Format;
  injuryStatus: string | null;
  injuryBodyPart: string | null;
  injuryNotes: string | null;
}) {
  const { rankFor: defenseRank } = usePositionalDefenseRanks();
  const { data: fpa } = useQuery({
    queryKey: ["fantasy-points-allowed", "sos-defense-ranks", "v2-incl-def"],
    staleTime: 6 * HOUR,
    retry: false,
    queryFn: () => fetchResearchFpa("half"),
  });
  const opp = nextGame?.opponent ?? null;
  const vsRank = defenseRank(pos, opp);
  const fpaPos = (pos === "DST" ? "DEF" : pos) as "QB" | "RB" | "WR" | "TE" | "K" | "DEF";
  const allowed = fpa?.rows.find((r) => r.team.toUpperCase() === opp?.toUpperCase())?.cells[fpaPos]?.pa ?? null;
  const focusWeek =
    nextGame?.seasonType === "regular" && nextGame.week > 0 ? nextGame.week : null;
  const sosRankByWeek = useMemo(() => {
    const map = new Map<number, number | null>();
    for (const m of sosOpponents ?? []) {
      map.set(Number(m.week), m.rank);
    }
    return map;
  }, [sosOpponents]);

  return (
    <>
      {team && nextGame ? (
        <Card title={nextGame.seasonType === "regular" ? `Week ${nextGame.week} Matchup` : "Next Game"}>
          <div className="flex items-center gap-3 px-4 py-3">
            {teamLogo(nextGame.opponent) ? (
              <img
                src={teamLogo(nextGame.opponent)!}
                alt=""
                className="size-12 shrink-0 rounded-full bg-m-chip object-contain p-1.5"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold">
                {nextGame.isHome ? "vs" : "@"} {teamFullName(nextGame.opponent)}
              </p>
              <p className="text-xs text-m-muted">{formatNflKickoffLabel(nextGame.date) || "Time TBD"}</p>
            </div>
            <div className="text-right">
              <p className="font-display text-2xl font-bold italic leading-none tabnum">
                {projected != null ? projected.toFixed(2) : "-"}
              </p>
              <p className="mt-1 text-xs text-m-muted">Proj. Pts</p>
            </div>
          </div>
          <div className="grid grid-cols-3 border-t border-m-border bg-m-row-alt py-2.5 text-center">
            <div>
              <p className="text-[10px] font-semibold uppercase text-m-muted">Rnk vs {pos}</p>
              <p className={cn("font-display text-base font-bold", rankTone(vsRank))}>{vsRank ? `#${vsRank}` : "-"}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase text-m-muted">Avg Pts to {pos}</p>
              <p className="font-display text-base font-bold tabnum">{allowed != null ? allowed.toFixed(2) : "-"}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase text-m-muted">Season SOS</p>
              <p className="font-display text-base font-bold">{sosGrade ?? "-"}</p>
            </div>
          </div>
        </Card>
      ) : null}

      <OverviewMarketRow id={id} format={format} />

      <OverviewInjuryNote
        playerId={id}
        status={injuryStatus}
        bodyPart={injuryBodyPart}
        notes={injuryNotes}
      />

      <WeekProjectionsStrip
        id={id}
        team={team}
        pos={pos}
        format={format}
        focusWeek={focusWeek}
        sosRankByWeek={sosRankByWeek}
      />

      <h3 className="px-4 pb-1 pt-6 font-display text-base font-bold uppercase tracking-[0.08em] text-m-muted">
        Latest News
      </h3>
      <PlayerNews id={id} />

      <PlayerTransactionHistory playerId={id} />
      <PlayerCareerTotals id={id} team={team} pos={pos} format={format} />
    </>
  );
}

function txnKindLabel(
  kind: LeagueActivityEvent["kind"],
  action: LeagueActivityMove["action"],
): string {
  if (kind === "trade") return "Traded";
  if (kind === "ir") return "IR";
  if (kind === "waiver") return action === "drop" ? "Dropped" : "Claimed";
  return action === "drop" ? "Dropped" : "Added";
}

function formatTxnDate(at: number): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" });
}

/** League transaction rows for this player — reuses the shared activity RQ cache. */
function PlayerTransactionHistory({ playerId }: { playerId: string }) {
  const { activeLeague } = useActiveLeague();
  const { events, loading } = useMobileLeagueActivity();

  const rows = useMemo(() => {
    const out: {
      id: string;
      at: number;
      label: string;
      detail: string;
    }[] = [];
    for (const event of events) {
      for (const move of event.moves) {
        if (String(move.playerId) !== String(playerId)) continue;
        const label = txnKindLabel(event.kind, move.action);
        let detail = "";
        if (event.kind === "trade") {
          const from = move.fromFantasyTeam?.trim();
          const to = move.fantasyTeam?.trim() || event.teamName?.trim();
          if (move.action === "add" && to) detail = `to ${to}`;
          else if (move.action === "drop" && (from || to)) detail = `from ${from || to}`;
          else detail = event.text;
        } else {
          const team = move.fantasyTeam?.trim() || event.teamName?.trim();
          detail = team ? `by ${team}` : event.text;
        }
        out.push({
          id: `${event.id}-${move.playerId}-${move.action}`,
          at: event.at,
          label,
          detail,
        });
      }
    }
    out.sort((a, b) => b.at - a.at);
    return out.slice(0, 12);
  }, [events, playerId]);

  return (
    <section className="mt-2 pb-1">
      <h3 className="px-4 pb-2 pt-6 font-display text-base font-bold uppercase tracking-[0.08em] text-m-muted">
        Transaction History
      </h3>
      {!activeLeague?.leagueId ? (
        <p className="px-4 text-sm text-m-muted">Sync a league to see this player&apos;s transactions.</p>
      ) : loading && !rows.length ? (
        <p className="px-4 text-sm text-m-muted">Loading transactions...</p>
      ) : !rows.length ? (
        <p className="px-4 text-sm text-m-muted">No league transactions for this player yet.</p>
      ) : (
        <div className="mx-2.5 overflow-hidden rounded-xl border border-m-border bg-m-card text-m-card-fg">
          {rows.map((row, idx) => (
            <div
              key={row.id}
              className={cn(
                "flex items-start gap-3 px-3.5 py-3",
                idx > 0 && "border-t border-m-border",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="font-display text-[13px] font-bold uppercase tracking-wide">{row.label}</p>
                <p className="mt-0.5 truncate text-[13px] text-m-muted">{row.detail}</p>
              </div>
              <p className="shrink-0 pt-0.5 text-[11px] tabular-nums text-m-muted">{formatTxnDate(row.at)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Career season totals (current + prior 2) — loaded only after the user expands. */
function PlayerCareerTotals({
  id,
  team,
  pos,
  format,
}: {
  id: string;
  team: string | null;
  pos: string;
  format: Format;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["player-logs", id, "career-totals", team ?? "FA", pos, "proj-v5"],
    enabled: Boolean(id && pos && open),
    staleTime: 30 * 60 * 1000,
    retry: false,
    queryFn: () =>
      fetchGameLogsClient(id, team ?? "FA", pos ?? "WR", null, { includeCareer: true }),
  });

  const career = useMemo(
    () =>
      (data?.career ?? []).filter(
        (row) => row.games > 0 || (row.pts[format] ?? 0) > 0,
      ) as CareerRow[],
    [data?.career, format],
  );

  const { leftCols, groups } = careerGroupedCols(pos, format);

  return (
    <section className="pb-6">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 px-4 pb-2 pt-6 text-left"
      >
        <h3 className="font-display text-base font-bold uppercase tracking-[0.08em] text-m-muted">
          Career
        </h3>
        <span
          className={cn(
            "text-[11px] font-bold uppercase tracking-wide",
            open ? "text-m-accent" : "text-m-muted",
          )}
        >
          {open ? "Hide" : "View"}
        </span>
      </button>
      {!open ? null : isLoading ? (
        <p className="px-4 text-sm text-m-muted">Loading career stats...</p>
      ) : !career.length ? (
        <p className="px-4 text-sm text-m-muted">No career stats available yet.</p>
      ) : (
        <GroupedStatTable
          title=""
          lead={{ key: "year", label: "Year", render: (r) => r.year }}
          leftCols={leftCols}
          groups={groups}
          rows={career}
          rowKey={(r) => `career-${r.year}`}
        />
      )}
    </section>
  );
}

function newsDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase();
  return `${day} at ${time}`;
}

function PlayerNews({ id }: { id: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["player-news", id, "cdn-v2"],
    queryFn: () => fetchPlayerNewsClient(id),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const items = (data?.items ?? []).slice(0, 6);

  if (isLoading) return <p className="px-4 py-6 text-sm text-m-muted">Loading news...</p>;
  if (!items.length) return <p className="px-4 py-6 text-sm text-m-muted">No recent news for this player.</p>;

  return (
    <>
      {items.map((item) => {
        const when = newsDate(item.published);
        return (
          <Card key={item.id}>
            <div className="px-4 py-4">
              {when ? <p className="font-display text-base font-semibold text-m-accent">{when}</p> : null}
              <p className="mt-1 text-[15px] font-semibold leading-snug">{item.headline}</p>
              {item.description ? (
                <p className="mt-1.5 text-[15px] leading-relaxed text-m-card-fg/90">{item.description}</p>
              ) : null}
              <p className="mt-2.5 text-xs font-semibold uppercase tracking-wide text-m-muted">{item.source}</p>
            </div>
          </Card>
        );
      })}
    </>
  );
}

type StatCol = { key: string; label: string };
type StatGroup = { label: string; cols: StatCol[] };

/** Position-specific counting groups (Sleeper-style Fantasy / Pass / Rush headers). */
function positionStatGroups(pos: string): StatGroup[] {
  switch ((pos || "").toUpperCase()) {
    case "QB":
      return [
        {
          label: "Passing",
          cols: [
            { key: "pass_cmp", label: "Cmp" },
            { key: "pass_att", label: "Att" },
            { key: "pass_yd", label: "Yd" },
            { key: "pass_td", label: "TD" },
            { key: "pass_int", label: "Int" },
          ],
        },
        {
          label: "Rushing",
          cols: [
            { key: "rush_att", label: "Att" },
            { key: "rush_yd", label: "Yd" },
            { key: "rush_td", label: "TD" },
          ],
        },
      ];
    case "RB":
      return [
        {
          label: "Rushing",
          cols: [
            { key: "rush_att", label: "Att" },
            { key: "rush_yd", label: "Yd" },
            { key: "rush_td", label: "TD" },
          ],
        },
        {
          label: "Receiving",
          cols: [
            { key: "rec_tgt", label: "Tgt" },
            { key: "rec", label: "Rec" },
            { key: "rec_yd", label: "Yd" },
            { key: "rec_td", label: "TD" },
          ],
        },
        {
          label: "Fumble",
          cols: [{ key: "fum_lost", label: "Lost" }],
        },
      ];
    case "K":
      return [
        {
          label: "Field Goals",
          cols: [
            { key: "fgm", label: "FGM" },
            { key: "fga", label: "FGA" },
            { key: "fgm_50p", label: "50+" },
          ],
        },
        {
          label: "Extra Points",
          cols: [
            { key: "xpm", label: "XPM" },
            { key: "xpa", label: "XPA" },
          ],
        },
      ];
    case "DEF":
      return [
        {
          label: "Defense",
          cols: [
            { key: "sack", label: "Sack" },
            { key: "int", label: "Int" },
            { key: "fum_rec", label: "FR" },
            { key: "def_td", label: "TD" },
            { key: "safe", label: "Sfty" },
            { key: "pts_allow", label: "PA" },
          ],
        },
      ];
    case "WR":
    case "TE":
    default:
      return [
        {
          label: "Receiving",
          cols: [
            { key: "rec_tgt", label: "Tgt" },
            { key: "rec", label: "Rec" },
            { key: "rec_yd", label: "Yd" },
            { key: "rec_td", label: "TD" },
          ],
        },
        {
          label: "Rushing",
          cols: [
            { key: "rush_att", label: "Att" },
            { key: "rush_yd", label: "Yd" },
            { key: "rush_td", label: "TD" },
          ],
        },
        {
          label: "Fumble",
          cols: [{ key: "fum_lost", label: "Lost" }],
        },
      ];
  }
}

function posRankStatKey(format: Format): string {
  if (format === "ppr") return "pos_rank_ppr";
  if (format === "std") return "pos_rank_std";
  return "pos_rank_half_ppr";
}

/** Format a counting stat. For played game-log rows, missing keys are 0 (Sleeper-style). */
const statValue = (
  raw: Record<string, number> | undefined,
  key: string,
  opts?: { zeroIfMissing?: boolean },
) => {
  const v = Number(raw?.[key]);
  if (Number.isFinite(v)) return Number.isInteger(v) ? String(v) : v.toFixed(1);
  return opts?.zeroIfMissing ? "0" : "-";
};

type TableCol<R> = {
  key: string;
  label: string;
  render: (row: R) => ReactNode;
  highlight?: boolean;
  /** Per-cell tone (e.g. weekly pos-rank heat). Overrides highlight bg when set. */
  cellClass?: (row: R) => string | undefined;
};
type ColGroup<R> = { label: string; cols: TableCol<R>[] };

/**
 * Soft heat for weekly Sleeper pos_rank_* (1 = best at position that week).
 * Same 10 / 22 bands as Team Rank chips — no extra data fetch.
 */
function weeklyPosRankCellClass(rank: number | null | undefined): string | undefined {
  if (rank == null || !Number.isFinite(rank) || rank <= 0) return undefined;
  if (rank <= 10) return "bg-emerald-500/25 font-semibold text-emerald-950";
  if (rank <= 22) return "bg-amber-400/30 font-semibold text-amber-950";
  return "bg-rose-500/25 font-semibold text-rose-950";
}

/**
 * Sleeper stamps unranked / DNP weeks as 999 (desktop treats ≥900 as empty).
 * Return a display rank or null so Game Log never shows the sentinel.
 */
function weeklyPosRankDisplay(raw: unknown): number | null {
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0 || v >= 900) return null;
  return Math.round(v);
}

/**
 * Sleeper-style double-tier Game Log: category row (Fantasy / Passing / …)
 * with a hairline gap between groups, then micro column labels.
 */
function GroupedStatTable<R>({
  title,
  lead,
  leftCols,
  groups,
  rows,
  rowKey,
}: {
  title: string;
  lead: TableCol<R>;
  leftCols: TableCol<R>[];
  groups: ColGroup<R>[];
  rows: R[];
  rowKey: (row: R) => string;
}) {
  return (
    <section className={title ? "mt-3" : undefined}>
      {title ? (
        <h3 className="px-4 pb-2 pt-3 font-display text-base font-bold uppercase tracking-[0.08em] text-m-muted">
          {title}
        </h3>
      ) : null}
      <div className="overflow-x-auto bg-m-card text-m-card-fg [scrollbar-width:none]">
        <table className="min-w-max border-collapse text-sm">
          <thead>
            <tr className="text-[10px] font-bold uppercase tracking-[0.12em] text-m-muted">
              {/* Sticky Week only — same clip edge as body rows (Opp + Fantasy slide under it). */}
              <th className="sticky left-0 z-10 w-[92px] bg-m-card px-3 py-1.5" aria-hidden />
              {leftCols.map((c) => (
                <th key={`cat-left-${c.key}`} className="min-w-[64px] px-3 py-1.5" aria-hidden />
              ))}
              {groups.map((g, gi) => (
                <th
                  key={g.label}
                  colSpan={g.cols.length}
                  className={cn(
                    "border-b border-m-border px-2 py-1.5 text-center",
                    gi > 0 && "border-l border-m-border/70",
                  )}
                >
                  {g.label}
                </th>
              ))}
            </tr>
            <tr className="border-b border-m-border text-[11px] font-semibold uppercase tracking-wide text-m-muted">
              <th className="sticky left-0 z-10 w-[92px] bg-m-card px-3 py-2.5 text-left">{lead.label}</th>
              {leftCols.map((c) => (
                <th key={c.key} className="min-w-[64px] px-3 py-2.5 text-right">
                  {c.label}
                </th>
              ))}
              {groups.map((g, gi) =>
                g.cols.map((c, ci) => (
                  <th
                    key={`${g.label}-${c.key}`}
                    className={cn(
                      "min-w-[56px] px-3 py-2.5 text-right",
                      ci === 0 && gi > 0 && "border-l border-m-border/70",
                      c.highlight && "bg-m-rank-col text-m-card-fg",
                    )}
                  >
                    {c.label}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-m-border last:border-0">
                <td className="sticky left-0 z-10 bg-m-card px-3 py-2.5 text-left font-semibold">
                  {lead.render(row)}
                </td>
                {leftCols.map((c) => (
                  <td key={c.key} className="px-3 py-2.5 text-right tabnum">
                    {c.render(row)}
                  </td>
                ))}
                {groups.map((g, gi) =>
                  g.cols.map((c, ci) => {
                    const heat = c.cellClass?.(row);
                    return (
                      <td
                        key={`${g.label}-${c.key}`}
                        className={cn(
                          "px-3 py-2.5 text-right tabnum",
                          ci === 0 && gi > 0 && "border-l border-m-border/70",
                          !heat && c.highlight && "bg-m-rank-col font-semibold",
                          heat,
                        )}
                      >
                        {c.render(row)}
                      </td>
                    );
                  }),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function usePlayerLogs(
  id: string,
  team: string | null | undefined,
  pos: string | null | undefined,
  season?: string | null,
  enabled = true,
) {
  const seasonKey = season && /^\d{4}$/.test(season) ? season : "current";
  return useQuery({
    // v3: snap% + weekly pos rank on raw; Fantasy / Pass / Rush grouped headers.
    // Past seasons: no includeCareer — one year at a time when the user expands VIEW.
    queryKey: ["player-logs", id, seasonKey, team ?? "FA", pos ?? "", "logs-v6"],
    enabled: Boolean(id && pos && enabled),
    queryFn: () =>
      fetchGameLogsClient(id, team ?? "FA", pos ?? "WR", seasonKey === "current" ? null : seasonKey, {
        includeCareer: false,
      }),
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
}

/** Seasons available in the Game Log accordion (current first). */
const MOBILE_LOG_SEASONS = ["2026", "2025", "2024", "2023", "2022"] as const;

function parseOppToken(opp: string | null | undefined): { label: string; abbr: string | null } {
  const raw = String(opp ?? "").trim();
  if (!raw || raw.toUpperCase() === "BYE") return { label: "BYE", abbr: null };
  const m = raw.match(/^(vs|@)\s+([A-Z]{2,3})$/i);
  if (m) return { label: `${m[1]!.toLowerCase() === "vs" ? "vs" : "@"} ${m[2]!.toUpperCase()}`, abbr: m[2]!.toUpperCase() };
  return { label: raw, abbr: null };
}

/** Horizontal week cards under Overview matchup — current week starts on the left. */
function WeekProjectionsStrip({
  id,
  team,
  pos,
  format,
  focusWeek,
  sosRankByWeek,
}: {
  id: string;
  team: string | null;
  pos: string;
  format: Format;
  focusWeek: number | null;
  /** Weekly positional SoS ranks from detail SOS board (current season). */
  sosRankByWeek?: Map<number, number | null> | null;
}) {
  const { data, isLoading } = usePlayerLogs(id, team, pos);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const weeks = data?.logs ?? [];
  const startWeek = focusWeek ?? weeks.find((l) => !l.played && !l.isBye)?.week ?? weeks[0]?.week ?? 1;

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || !weeks.length) return;
    const target = root.querySelector<HTMLElement>(`[data-proj-week="${startWeek}"]`);
    if (!target) return;
    // Keep current week flush left; past weeks sit to the left for swipe-back.
    root.scrollLeft = Math.max(0, target.offsetLeft - 16);
  }, [startWeek, weeks.length, id]);

  if (isLoading) {
    return <p className="px-4 py-5 text-sm text-m-muted">Loading projections...</p>;
  }
  if (!weeks.length) return null;

  return (
    <section className="mt-4">
      <h3 className="px-4 pb-2 font-display text-base font-bold uppercase tracking-[0.08em] text-m-muted">
        Projections
      </h3>
      <div
        ref={scrollerRef}
        className="flex gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {weeks.map((log) => {
          const opp = parseOppToken(log.opp);
          const logo = opp.abbr ? teamLogo(opp.abbr) : null;
          const proj =
            log.isBye || log.proj?.[format] == null ? null : Number(log.proj[format]);
          const finalPts =
            log.isBye || !log.played ? null : Number(log.points[format]);
          const sosRank = sosRankByWeek?.get(log.week);
          const oppClass =
            !log.isBye && sosRank != null && Number.isFinite(sosRank)
              ? cn("font-semibold", sosOppTextClass(sosRank))
              : "text-m-card-fg";
          return (
            <div key={log.week} data-proj-week={log.week} className="w-[7.75rem] shrink-0">
              <div className="mb-1.5 flex items-center justify-center gap-1.5 px-0.5">
                <p className="min-w-0 truncate text-center text-[11px] font-semibold uppercase tracking-wide">
                  <span className="text-m-card-fg">Wk {log.week}</span>{" "}
                  {log.isBye ? (
                    <span className="text-m-muted">BYE</span>
                  ) : (
                    <span className={oppClass}>{opp.label}</span>
                  )}
                </p>
                {logo ? (
                  <img src={logo} alt="" className="size-4 shrink-0 rounded-full object-contain" />
                ) : null}
              </div>
              <div className="overflow-hidden rounded-lg border border-m-border bg-m-card text-m-card-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
                <div className="flex items-baseline justify-between gap-2 px-2.5 py-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-m-muted">Proj</span>
                  <span className="font-display text-[15px] font-bold tabular-nums">
                    {proj != null && Number.isFinite(proj) ? proj.toFixed(2) : "-"}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2 border-t border-m-border bg-m-row-alt px-2.5 py-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-m-muted">Final</span>
                  <span className="font-display text-[15px] font-bold tabular-nums">
                    {finalPts != null && Number.isFinite(finalPts) ? finalPts.toFixed(2) : "-"}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

type GameLogRow = {
  week: number;
  opp: string | null;
  isBye: boolean;
  played: boolean;
  points: { std: number; half: number; ppr: number };
  proj: { std: number; half: number; ppr: number } | null;
  raw: Record<string, number>;
};

type CareerRow = {
  year: string;
  team: string;
  games: number;
  pts: { std: number | null; half: number | null; ppr: number | null };
  raw: Record<string, number>;
};

/** Same Fantasy / Passing / Rushing group headers as Game Log; Year + Tm/GM on the left. */
function careerGroupedCols(
  pos: string,
  format: Format,
): { leftCols: TableCol<CareerRow>[]; groups: ColGroup<CareerRow>[] } {
  const leftCols: TableCol<CareerRow>[] = [
    { key: "team", label: "Tm", render: (r) => r.team || "-" },
    { key: "gm", label: "GM", render: (r) => (r.games > 0 ? String(r.games) : "-") },
  ];
  const fantasy: ColGroup<CareerRow> = {
    label: "Fantasy",
    cols: [
      {
        key: "fpts",
        label: "Fpts",
        highlight: true,
        render: (r) => (r.pts[format] != null ? Number(r.pts[format]).toFixed(1) : "-"),
      },
    ],
  };
  const groups: ColGroup<CareerRow>[] = [
    fantasy,
    ...positionStatGroups(pos).map((g) => ({
      label: g.label,
      cols: g.cols.map((c) => ({
        key: c.key,
        label: c.label,
        render: (r: CareerRow) =>
          r.games > 0 ? statValue(r.raw, c.key, { zeroIfMissing: true }) : "-",
      })),
    })),
  ];
  return { leftCols, groups };
}

function gameLogGroupedCols(
  pos: string,
  format: Format,
  /** Weekly positional SoS ranks (current season only). */
  sosRankByWeek?: Map<number, number | null> | null,
): { leftCols: TableCol<GameLogRow>[]; groups: ColGroup<GameLogRow>[] } {
  const rankKey = posRankStatKey(format);
  const leftCols: TableCol<GameLogRow>[] = [
    {
      key: "opp",
      label: "Opp",
      render: (l) => {
        if (l.isBye) return <span className="text-m-muted">BYE</span>;
        const label = l.opp ?? "-";
        const rank = sosRankByWeek?.get(l.week);
        if (rank == null || !Number.isFinite(rank)) return label;
        return <span className={cn("font-semibold", sosOppTextClass(rank))}>{label}</span>;
      },
    },
  ];
  const fantasy: ColGroup<GameLogRow> = {
    label: "Fantasy",
    cols: [
      {
        key: "proj",
        label: "Proj",
        render: (l) => (l.isBye || l.proj?.[format] == null ? "-" : l.proj[format]!.toFixed(1)),
      },
      {
        key: "fpts",
        label: "Fpts",
        highlight: true,
        render: (l) => (l.isBye || !l.played ? "-" : l.points[format].toFixed(1)),
      },
      {
        key: "snap_pct",
        label: "Snp%",
        render: (l) => {
          if (l.isBye || !l.played) return "-";
          const v = Number(l.raw?.["snap_pct"]);
          return Number.isFinite(v) ? `${Math.round(v)}%` : "-";
        },
      },
      {
        key: "rank",
        label: "Rank",
        cellClass: (l) => {
          if (l.isBye || !l.played) return undefined;
          return weeklyPosRankCellClass(weeklyPosRankDisplay(l.raw?.[rankKey]));
        },
        render: (l) => {
          if (l.isBye || !l.played) return "-";
          const v = weeklyPosRankDisplay(l.raw?.[rankKey]);
          return v != null ? String(v) : "-";
        },
      },
    ],
  };
  const groups: ColGroup<GameLogRow>[] = [
    fantasy,
    ...positionStatGroups(pos).map((g) => ({
      label: g.label,
      cols: g.cols.map((c) => ({
        key: c.key,
        label: c.label,
        // Played games: show 0 for omitted zero stats (e.g. INT / Pass TD), not "-".
        render: (l: GameLogRow) =>
          l.isBye || !l.played ? "-" : statValue(l.raw, c.key, { zeroIfMissing: true }),
      })),
    })),
  ];
  return { leftCols, groups };
}

function GameLogTab({
  id,
  team,
  pos,
  format,
  exp,
}: {
  id: string;
  team: string | null;
  pos: string;
  format: Format;
  exp: number | null;
}) {
  const nflState = useNflState();
  const currentSeason = String(nflState.data?.season ?? MOBILE_LOG_SEASONS[0]);
  const { data, isLoading } = usePlayerLogs(id, team, pos);
  const [openPast, setOpenPast] = useState<string | null>(null);
  const brain = usePlayerBrain();
  const playerSos = usePlayerSos(brain?.[id] ?? null, team, format, pos);
  const sosRankByWeek = useMemo(() => {
    const map = new Map<number, number | null>();
    for (const m of playerSos?.matchups ?? []) {
      map.set(Number(m.week), m.rank);
    }
    return map;
  }, [playerSos]);

  const pastSeasons = useMemo(() => {
    // Sleeper years_exp is 0 for rookies, then +1 per completed season.
    // Entry year = currentYear - years_exp (e.g. Daniels exp=2 in 2026 → 2024).
    const isDefense = pos === "DEF";
    const currentYear = Number.parseInt(currentSeason, 10) || Number(MOBILE_LOG_SEASONS[0]);
    if (isDefense) {
      return MOBILE_LOG_SEASONS.filter((y) => {
        const n = Number.parseInt(y, 10);
        return n < currentYear && n >= 2022;
      });
    }
    const yearsExp = Math.floor(Number(exp));
    if (!Number.isFinite(yearsExp) || yearsExp <= 0) return [];
    const entryYear = currentYear - yearsExp;
    return MOBILE_LOG_SEASONS.filter((y) => {
      const n = Number.parseInt(y, 10);
      return n < currentYear && n >= entryYear;
    });
  }, [currentSeason, exp, pos]);

  // Full 1–18 season board; unplayed weeks stay as "-" until the game is final.
  const logs = data?.logs ?? [];
  const { leftCols, groups } = useMemo(
    () => gameLogGroupedCols(pos, format, sosRankByWeek),
    [pos, format, sosRankByWeek],
  );
  const seasonLabel = data?.season ?? currentSeason;

  if (isLoading) return <p className="px-4 py-8 text-center text-sm text-m-muted">Loading game log...</p>;

  return (
    <div className="pb-4">
      {!logs.length ? (
        <p className="px-4 py-8 text-center text-sm text-m-muted">No games played yet this season.</p>
      ) : (
        <GroupedStatTable
          title={seasonLabel}
          lead={{ key: "week", label: "Week", render: (l) => `Week ${l.week}` }}
          leftCols={leftCols}
          groups={groups}
          rows={logs}
          rowKey={(l) => String(l.week)}
        />
      )}

      {pastSeasons.length ? (
        <section className="mt-2">
          <h3 className="px-4 pb-1 pt-3 font-display text-base font-bold uppercase tracking-[0.08em] text-m-muted">
            Past Seasons
          </h3>
          {pastSeasons.map((year) => {
            const open = openPast === year;
            return (
              <div key={year}>
                <button
                  type="button"
                  onClick={() => setOpenPast((prev) => (prev === year ? null : year))}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span className="font-display text-base font-bold">{year}</span>
                  <span
                    className={cn(
                      "text-[11px] font-bold uppercase tracking-wide",
                      open ? "text-m-accent" : "text-m-muted",
                    )}
                  >
                    {open ? "Hide" : "View"}
                  </span>
                </button>
                {open ? (
                  <PastSeasonGameLog id={id} team={team} pos={pos} format={format} season={year} />
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}

function PastSeasonGameLog({
  id,
  team,
  pos,
  format,
  season,
}: {
  id: string;
  team: string | null;
  pos: string;
  format: Format;
  season: string;
}) {
  const { data, isLoading } = usePlayerLogs(id, team, pos, season, true);
  // Same full week board as the current season (unplayed weeks stay "-").
  const logs = data?.logs ?? [];
  const { leftCols, groups } = useMemo(() => gameLogGroupedCols(pos, format), [pos, format]);

  if (isLoading) {
    return <p className="px-4 py-8 text-center text-sm text-m-muted">Loading {season}...</p>;
  }
  if (!logs.length) {
    return <p className="px-4 py-8 text-center text-sm text-m-muted">No games recorded for {season}.</p>;
  }

  return (
    <GroupedStatTable
      title=""
      lead={{ key: "week", label: "Week", render: (l) => `Week ${l.week}` }}
      leftCols={leftCols}
      groups={groups}
      rows={logs}
      rowKey={(l) => `${season}-${l.week}`}
    />
  );
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Lower rank = better offense production (1st best). */
function offenseRankTone(rank: number | null): string {
  if (rank == null) return "bg-m-chip text-m-chip-fg";
  if (rank <= 10) return "bg-emerald-500 text-white";
  if (rank <= 22) return "bg-amber-400 text-slate-950";
  return "bg-rose-500 text-white";
}

type TeamRankChip = { key: string; label: string; rank: number };

function splitPlayerName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: "", last: parts[0] ?? name };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

const POS_LABEL_CLASS: Record<string, string> = {
  QB: "text-qb",
  RB: "text-rb",
  WR: "text-wr",
  WR1: "text-wr",
  WR2: "text-wr",
  WR3: "text-wr",
  TE: "text-te",
  K: "text-k",
  DEF: "text-def",
};

type DepthEntry = {
  id: string;
  name: string;
  pos: string;
  proj: number;
  injury: string | null;
};

function TeamTab({
  playerId,
  pos,
  team,
  depthChart,
  onSelectPlayer,
}: {
  playerId: string;
  pos: string;
  team: string | null;
  depthChart: DepthEntry[];
  onSelectPlayer: (id: string) => void;
}) {
  const nflState = useNflState();
  const season = nflState.data?.season ?? String(new Date().getUTCFullYear());
  const { data: catalog } = useSleeperPlayers();
  // Active-week proj (same path as matchup / ATP) — not season ROS from depthChart.
  const { projectFor } = useLeagueProjections();
  // Same shared week-proj overlay as popup header / ATP / catalog badges.
  const liveInjuries = useLiveInjuryStatuses();
  const playersById = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of catalog?.players ?? []) map.set(p.id, p);
    return map;
  }, [catalog?.players]);

  // Sleeper TEAM_* ranks via snap-cdn (Actions warm) — not visitor Sleeper/ESPN.
  const { data: offenseRanksBoard, isLoading: ranksLoading } = useQuery({
    queryKey: ["nfl-team-offense-ranks", "sleeper-v5", season],
    enabled: Boolean(team),
    staleTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
    retry: false,
    queryFn: () => fetchNflTeamOffenseRanks(season),
  });

  // Sleeper depth_chart_position + order via dedicated snap (not SOS / not proj-sorted).
  const { data: depthBoard, isLoading: depthLoading } = useQuery({
    queryKey: ["nfl-team-depth", "snap-v1"],
    enabled: Boolean(team),
    staleTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
    retry: false,
    queryFn: () => fetchNflTeamDepth(),
  });

  const rankChips = useMemo(() => {
    const ranks = teamOffenseRanksFor(offenseRanksBoard, team);
    if (!ranks) return [] as TeamRankChip[];
    // Match Sleeper: chips follow the viewed player's position (not always pass).
    return teamRankChipsForPos(pos)
      .map(({ key, label }) => {
        const rank = ranks[key];
        return rank != null && rank > 0 ? { key, label, rank } : null;
      })
      .filter((x): x is TeamRankChip => x != null);
  }, [offenseRanksBoard, pos, team]);

  /** Injury token for depth cells — same path as popup header (live overlay + resolveInjuryStatus). Never snap/proj injury. */
  const injuryStatusFor = useCallback(
    (id: string): string | null => {
      const live = liveInjuries.data?.[id];
      const meta = playersById.get(id);
      const carrier =
        live !== undefined
          ? {
              injury_status: live.status?.trim() || null,
              injury: live.status?.trim() || null,
            }
          : meta
            ? meta
            : null;
      if (!carrier) return null;
      return resolveInjuryStatus(carrier) ?? carrier.injury_status ?? null;
    },
    [liveInjuries.data, playersById],
  );

  const depthRows = useMemo(() => {
    const chart = teamDepthFor(depthBoard, team);
    const projById = new Map(depthChart.map((d) => [d.id, d]));

    const toCells = (slot: TeamDepthSlot, entries: TeamDepthEntry[] | undefined) => {
      const top = (entries ?? []).slice(0, 3);
      const cells = [0, 1, 2].map((i) => {
        const entry = top[i];
        if (!entry) return null;
        const hit = projById.get(entry.id);
        const meta = playersById.get(entry.id);
        // Snap owns starter/2nd/3rd order only; injury comes from Sleeper client overlay.
        return {
          id: entry.id,
          name: entry.name || hit?.name || meta?.name || entry.id,
          pos: slot.startsWith("WR") ? "WR" : slot,
          proj: hit?.proj ?? 0,
          injury: injuryStatusFor(entry.id),
        } satisfies DepthEntry;
      });
      return cells as [DepthEntry | null, DepthEntry | null, DepthEntry | null];
    };

    const slots: TeamDepthSlot[] = ["QB", "RB", "WR1", "WR2", "WR3", "TE", "K"];
    return slots.map((label) => ({ label, cells: toCells(label, chart?.[label]) }));
  }, [depthBoard, depthChart, injuryStatusFor, playersById, team]);

  if (!team) {
    return <p className="px-4 py-8 text-center text-sm text-m-muted">No team depth chart for free agents.</p>;
  }

  return (
    <div className="pb-6">
      <h3 className="px-4 pb-2 pt-4 font-display text-base font-bold uppercase tracking-[0.08em] text-m-muted">
        Team Rank
      </h3>
      {rankChips.length ? (
        <div className="flex gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {rankChips.map((chip) => (
            <div key={chip.key} className="w-[4.75rem] shrink-0 text-center">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-m-muted">{chip.label}</p>
              <div
                className={cn(
                  "rounded-md px-2 py-2 font-display text-sm font-bold tabular-nums",
                  offenseRankTone(chip.rank),
                )}
              >
                {ordinal(chip.rank)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="px-4 text-sm text-m-muted">
          {ranksLoading ? "Loading team ranks..." : "Team ranks unavailable."}
        </p>
      )}

      <h3 className="px-4 pb-2 pt-5 font-display text-base font-bold uppercase tracking-[0.08em] text-m-muted">
        Depth Chart
      </h3>
      <div className="mx-2.5 overflow-hidden rounded-xl border border-m-border bg-m-card text-m-card-fg">
        <div className="grid grid-cols-[2.75rem_1fr_1fr_1fr] border-b border-m-border bg-m-row-alt px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-m-muted">
          <span>Pos</span>
          <span>Starter</span>
          <span>2nd</span>
          <span>3rd</span>
        </div>
        {depthRows.every((r) => r.cells.every((c) => c == null)) ? (
          <p className="px-4 py-6 text-center text-sm text-m-muted">
            {depthLoading ? "Loading depth chart..." : "No depth chart available."}
          </p>
        ) : (
          depthRows.map((row, idx) => (
            <div
              key={row.label}
              className={cn(
                "grid grid-cols-[2.75rem_1fr_1fr_1fr] border-b border-m-border px-2 py-2.5 last:border-0",
                idx % 2 === 1 && "bg-m-row-alt/60",
              )}
            >
              <div className={cn("pt-0.5 text-xs font-black", POS_LABEL_CLASS[row.label] ?? "text-m-muted")}>
                {row.label}
              </div>
              {row.cells.map((cell, col) => {
                if (!cell) {
                  return <div key={`${row.label}-${col}`} />;
                }
                const meta = playersById.get(cell.id);
                const age = meta?.age;
                // Same badge path as popup header: resolveInjuryStatus → injuryBadgeInfo.
                const badge = injuryBadgeInfo(cell.injury);
                const { first, last } = splitPlayerName(cell.name);
                const isActive = cell.id === playerId;
                const weekProj = projectFor(cell.id);
                return (
                  <button
                    key={cell.id}
                    type="button"
                    onClick={() => onSelectPlayer(cell.id)}
                    className={cn(
                      "min-w-0 rounded-md px-1 py-0.5 text-left",
                      isActive && "bg-m-highlight",
                    )}
                  >
                    <div className="flex items-center gap-1">
                      {age != null ? (
                        <span className="text-[10px] text-m-muted">{age} y/o</span>
                      ) : null}
                      {badge ? (
                        <span className={cn("rounded px-1 text-[9px] font-black", badge.className)}>
                          {badge.letter}
                        </span>
                      ) : null}
                    </div>
                    {first ? <p className="truncate text-[10px] leading-tight text-m-muted">{first}</p> : null}
                    <p
                      className={cn(
                        "truncate text-[12px] font-bold leading-tight",
                        isActive ? "text-m-accent" : "text-m-card-fg",
                      )}
                    >
                      {last}
                    </p>
                    {weekProj != null && Number.isFinite(weekProj) && weekProj > 0 ? (
                      <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-m-muted">
                        {weekProj.toFixed(1)}
                      </p>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      <InjuryStatusLegend />
    </div>
  );
}

/** Status key for depth-chart badges — same chips/colors as the rest of the app. */
const TEAM_STATUS_LEGEND: { status: string; label: string }[] = [
  { status: "IR", label: "Injured Reserve" },
  { status: "PUP", label: "Physically Unable to Perform" },
  { status: "SUS", label: "Suspended" },
  { status: "O", label: "Out" },
  { status: "D", label: "Doubtful" },
  { status: "Q", label: "Questionable" },
];

function InjuryStatusLegend() {
  return (
    <section className="mx-2.5 mt-4 overflow-hidden rounded-xl border border-m-border bg-m-card px-4 py-3 text-m-card-fg">
      <h4 className="mb-2.5 font-display text-xs font-bold uppercase tracking-[0.08em] text-m-muted">
        Status Legend
      </h4>
      <ul className="space-y-2">
        {TEAM_STATUS_LEGEND.map((row) => {
          const badge = injuryBadgeInfo(row.status);
          if (!badge) return null;
          return (
            <li key={row.status} className="flex items-center gap-3">
              <span
                className={cn(
                  "inline-flex min-w-[2.25rem] items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-black",
                  badge.className,
                )}
              >
                {badge.letter}
              </span>
              <span className="text-[13px] text-m-muted">{row.label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

