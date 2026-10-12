import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
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
import { useLeagueProjections, useNflState } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { usePositionalDefenseRanks } from "@/hooks/usePositionalDefenseRanks";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Pos } from "@/lib/draft";
import { injuryBadgeInfo } from "@/lib/injury-badge";
import {
  fetchNflTeamOffenseRanks,
  teamOffenseRanksFor,
  type TeamOffenseRankKey,
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
import {
  fetchGameLogsClient,
  fetchNextGameClient,
  fetchPlayerBioClient,
} from "@/lib/sleeper-client";
import { cn } from "@/lib/utils";

/** Pointy-top hexagon for the raised position-rank badge. */
const RANK_HEX_CLIP = "polygon(50% 0%, 100% 24%, 100% 76%, 50% 100%, 0% 76%, 0% 24%)";
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

function MobilePlayerSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const [tab, setTab] = useState<SheetTab>("overview");
  const openPlayer = useOpenMobilePlayer();
  // Reuses the league-rosters React Query cache — no catalog fetch required.
  const { ownerByPlayerId } = useLeagueRosters([]);
  const fantasyOwner = ownerByPlayerId.get(id) ?? null;

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Keep Team tab when hopping via depth chart; otherwise land on Overview.
  useEffect(() => {
    setTab((prev) => (prev === "team" ? "team" : "overview"));
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

  return (
    <div role="dialog" aria-modal="true" aria-label={player?.name ?? "Player"} className="fixed inset-0 z-50 overflow-y-auto bg-m-bg">
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
          <button
            type="button"
            onClick={onClose}
            aria-label="Close player"
            className="absolute right-3 top-3 z-10 inline-flex size-10 items-center justify-center rounded-full bg-m-icon-bg text-m-icon-fg"
          >
            <X className="size-5" strokeWidth={2.5} />
          </button>

          {detail.isLoading ? (
            <p className="relative z-[1] px-5 py-24 text-center text-sm text-m-muted">Loading player...</p>
          ) : !player ? (
            <p className="relative z-[1] px-5 py-24 text-center text-sm text-m-muted">Player details are unavailable.</p>
          ) : (
            <div className="relative z-[1] flex min-h-[220px] items-end">
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
                  <p className="mt-2 truncate text-[13px] font-medium text-m-card-fg">
                    {fantasyOwner}
                  </p>
                ) : null}
                {injuryInfo ? (
                  <span
                    className={cn(
                      "mt-3 inline-block rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wide",
                      injuryInfo.className,
                    )}
                  >
                    {injuryInfo.text}
                  </span>
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
          )}
        </section>

        {player ? (
          <>
            <div className="relative grid grid-cols-5 items-center border-y border-m-border bg-m-card py-3 text-center text-m-card-fg">
              <StatCell label="Bye Wk" value={player.bye != null ? String(player.bye) : "-"} />
              <StatCell label="Avg Pts" value={avgPts != null ? avgPts.toFixed(2) : "-"} />
              <div className="relative flex justify-center self-stretch">
                <div
                  className="absolute -top-[38px] z-[2]"
                  style={{ filter: "drop-shadow(0 3px 5px rgba(0,0,0,0.16)) drop-shadow(0 0 1px rgba(0,0,0,0.22))" }}
                >
                  <span
                    className="flex h-[92px] w-[80px] flex-col items-center justify-center bg-m-card"
                    style={{ clipPath: RANK_HEX_CLIP }}
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-m-muted">
                      {player.pos} Rnk
                    </span>
                    <span className="mt-0.5 font-display text-[34px] font-bold leading-none">{posRank ?? "-"}</span>
                  </span>
                </div>
              </div>
              <StatCell label="Own %" value={ownedPct != null ? `${Math.round(Number(ownedPct))}` : "-"} />
              <StatCell label="Start %" value={startedPct != null ? `${Math.round(Number(startedPct))}` : "-"} />
            </div>

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
                format={format}
              />
            ) : tab === "logs" ? (
              <GameLogTab id={id} team={team} pos={player.pos} format={format} />
            ) : (
              <TeamTab
                playerId={id}
                team={team}
                depthChart={detail.data?.depthChart ?? []}
                onSelectPlayer={openPlayer}
              />
            )}
          </>
        ) : null}
      </div>
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
  format,
}: {
  id: string;
  pos: string;
  team: string | null;
  nextGame: Awaited<ReturnType<typeof fetchNextGameClient>> | null;
  projected: number | null;
  sosGrade: string | null;
  format: Format;
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

      <WeekProjectionsStrip id={id} team={team} pos={pos} format={format} focusWeek={focusWeek} />

      <h3 className="px-4 pb-1 pt-6 font-display text-base font-bold uppercase tracking-[0.08em] text-m-muted">
        Latest News
      </h3>
      <PlayerNews id={id} />
    </>
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

/** Counting-stat columns per fantasy position (Sleeper raw stat keys). */
const POS_STAT_COLS: Record<string, StatCol[]> = {
  QB: [
    { key: "pass_cmp", label: "Cmp" },
    { key: "pass_att", label: "Att" },
    { key: "pass_yd", label: "Pass Yd" },
    { key: "pass_td", label: "Pass TD" },
    { key: "pass_int", label: "Int" },
    { key: "rush_att", label: "Rush" },
    { key: "rush_yd", label: "Rush Yd" },
    { key: "rush_td", label: "Rush TD" },
  ],
  RB: [
    { key: "rush_att", label: "Rush" },
    { key: "rush_yd", label: "Rush Yd" },
    { key: "rush_td", label: "Rush TD" },
    { key: "rec_tgt", label: "Tgt" },
    { key: "rec", label: "Rec" },
    { key: "rec_yd", label: "Rec Yd" },
    { key: "rec_td", label: "Rec TD" },
    { key: "fum_lost", label: "Fum" },
  ],
  WR: [
    { key: "rec_tgt", label: "Tgt" },
    { key: "rec", label: "Rec" },
    { key: "rec_yd", label: "Rec Yd" },
    { key: "rec_td", label: "Rec TD" },
    { key: "rush_att", label: "Rush" },
    { key: "rush_yd", label: "Rush Yd" },
    { key: "rush_td", label: "Rush TD" },
    { key: "fum_lost", label: "Fum" },
  ],
  K: [
    { key: "fgm", label: "FGM" },
    { key: "fga", label: "FGA" },
    { key: "fgm_50p", label: "50+" },
    { key: "xpm", label: "XPM" },
    { key: "xpa", label: "XPA" },
  ],
  DEF: [
    { key: "sack", label: "Sack" },
    { key: "int", label: "Int" },
    { key: "fum_rec", label: "FR" },
    { key: "def_td", label: "TD" },
    { key: "safe", label: "Safety" },
    { key: "pts_allow", label: "Pts Alw" },
  ],
};
POS_STAT_COLS["TE"] = POS_STAT_COLS["WR"]!;

const statValue = (raw: Record<string, number> | undefined, key: string) => {
  const v = Number(raw?.[key]);
  return Number.isFinite(v) ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : "-";
};

type TableCol<R> = { key: string; label: string; render: (row: R) => string; highlight?: boolean };

/** Players-page style table: sticky first column, horizontally scrolling stat columns. */
function StatTable<R>({
  title,
  lead,
  cols,
  rows,
  rowKey,
}: {
  title: string;
  lead: TableCol<R>;
  cols: TableCol<R>[];
  rows: R[];
  rowKey: (row: R) => string;
}) {
  return (
    <section className="mt-3">
      <h3 className="px-4 pb-2 pt-3 font-display text-base font-bold uppercase tracking-[0.08em] text-m-muted">{title}</h3>
      <div className="overflow-x-auto bg-m-card text-m-card-fg [scrollbar-width:none]">
        <table className="min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b border-m-border text-[11px] font-semibold uppercase tracking-wide text-m-muted">
              <th className="sticky left-0 z-10 w-[92px] bg-m-card px-3 py-2.5 text-left">{lead.label}</th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={cn("min-w-[64px] px-3 py-2.5 text-right", c.highlight && "bg-m-rank-col text-m-card-fg")}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-m-border last:border-0">
                <td className="sticky left-0 z-10 bg-m-card px-3 py-2.5 text-left font-semibold">{lead.render(row)}</td>
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className={cn("px-3 py-2.5 text-right tabnum", c.highlight && "bg-m-rank-col font-semibold")}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function usePlayerLogs(id: string, team: string | null | undefined, pos: string | null | undefined) {
  return useQuery({
    // v2: past-week Proj from shared week projection bundles.
    queryKey: ["player-logs", id, "current", team ?? "FA", pos ?? "", "proj-v2"],
    enabled: Boolean(id && pos),
    queryFn: () =>
      fetchGameLogsClient(id, team ?? "FA", pos ?? "WR", null, { includeCareer: false }),
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
}

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
}: {
  id: string;
  team: string | null;
  pos: string;
  format: Format;
  focusWeek: number | null;
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
          return (
            <div key={log.week} data-proj-week={log.week} className="w-[7.75rem] shrink-0">
              <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
                <p className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide text-m-card-fg">
                  Wk {log.week} {log.isBye ? "BYE" : opp.label}
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

function GameLogTab({
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
  const { data, isLoading } = usePlayerLogs(id, team, pos);
  // Full 1–18 season board; unplayed weeks stay as "-" until the game is final.
  const logs = data?.logs ?? [];

  if (isLoading) return <p className="px-4 py-8 text-center text-sm text-m-muted">Loading game log...</p>;
  if (!logs.length) return <p className="px-4 py-8 text-center text-sm text-m-muted">No games played yet this season.</p>;

  type Log = (typeof logs)[number];
  const statCols = POS_STAT_COLS[pos] ?? POS_STAT_COLS["WR"]!;
  const cols: TableCol<Log>[] = [
    { key: "opp", label: "Opp", render: (l) => (l.isBye ? "BYE" : (l.opp ?? "-")) },
    {
      key: "fpts",
      label: "Fpts",
      highlight: true,
      render: (l) => (l.isBye || !l.played ? "-" : l.points[format].toFixed(1)),
    },
    {
      key: "proj",
      label: "Proj",
      render: (l) => (l.isBye || l.proj?.[format] == null ? "-" : l.proj[format]!.toFixed(1)),
    },
    ...statCols.map((c) => ({
      key: c.key,
      label: c.label,
      render: (l: Log) => (l.isBye || !l.played ? "-" : statValue(l.raw, c.key)),
    })),
  ];

  return (
    <StatTable
      title={`${data?.season ?? ""} Game Log`.trim()}
      lead={{ key: "week", label: "Week", render: (l) => `Week ${l.week}` }}
      cols={cols}
      rows={logs}
      rowKey={(l) => String(l.week)}
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

const TEAM_RANK_CHIP_META: { key: TeamOffenseRankKey; label: string }[] = [
  { key: "offense", label: "Offense" },
  { key: "passAtt", label: "Pass Att" },
  { key: "passYd", label: "Pass Yd" },
  { key: "passTd", label: "Pass TD" },
  { key: "td", label: "TD" },
  { key: "rz", label: "RZ" },
  { key: "rzPct", label: "RZ %" },
];

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
  team,
  depthChart,
  onSelectPlayer,
}: {
  playerId: string;
  team: string | null;
  depthChart: DepthEntry[];
  onSelectPlayer: (id: string) => void;
}) {
  const nflState = useNflState();
  const season = nflState.data?.season ?? String(new Date().getUTCFullYear());
  const { data: catalog } = useSleeperPlayers();
  const playersById = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of catalog?.players ?? []) map.set(p.id, p);
    return map;
  }, [catalog?.players]);

  // Official ESPN team ranks via snap-cdn (Actions warm) — not visitor Sleeper/ESPN.
  const { data: offenseRanksBoard, isLoading: ranksLoading } = useQuery({
    queryKey: ["nfl-team-offense-ranks", season],
    enabled: Boolean(team),
    staleTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
    retry: false,
    queryFn: () => fetchNflTeamOffenseRanks(season),
  });

  const rankChips = useMemo(() => {
    const ranks = teamOffenseRanksFor(offenseRanksBoard, team);
    if (!ranks) return [] as TeamRankChip[];
    return TEAM_RANK_CHIP_META.map(({ key, label }) => {
      const rank = ranks[key];
      return rank != null && rank > 0 ? { key, label, rank } : null;
    }).filter((x): x is TeamRankChip => x != null);
  }, [offenseRanksBoard, team]);

  const depthRows = useMemo(() => {
    const byPos = {
      QB: depthChart.filter((d) => d.pos === "QB").sort((a, b) => b.proj - a.proj),
      RB: depthChart.filter((d) => d.pos === "RB").sort((a, b) => b.proj - a.proj),
      WR: depthChart.filter((d) => d.pos === "WR").sort((a, b) => b.proj - a.proj),
      TE: depthChart.filter((d) => d.pos === "TE").sort((a, b) => b.proj - a.proj),
      K: depthChart.filter((d) => d.pos === "K").sort((a, b) => b.proj - a.proj),
    };
    const take3 = (list: DepthEntry[]) => [list[0] ?? null, list[1] ?? null, list[2] ?? null] as const;
    const wr = byPos.WR;
    return [
      { label: "QB", cells: take3(byPos.QB) },
      { label: "RB", cells: take3(byPos.RB) },
      { label: "WR1", cells: [wr[0] ?? null, wr[3] ?? null, wr[6] ?? null] as const },
      { label: "WR2", cells: [wr[1] ?? null, wr[4] ?? null, wr[7] ?? null] as const },
      { label: "WR3", cells: [wr[2] ?? null, wr[5] ?? null, wr[8] ?? null] as const },
      { label: "TE", cells: take3(byPos.TE) },
      { label: "K", cells: take3(byPos.K) },
    ];
  }, [depthChart]);

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
          <span>Off</span>
          <span>Starter</span>
          <span>2nd</span>
          <span>3rd</span>
        </div>
        {depthRows.every((r) => r.cells.every((c) => c == null)) ? (
          <p className="px-4 py-6 text-center text-sm text-m-muted">No depth chart available.</p>
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
                const badge = injuryBadgeInfo(cell.injury ?? meta?.injury_status ?? meta?.injury);
                const { first, last } = splitPlayerName(cell.name);
                const isActive = cell.id === playerId;
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

