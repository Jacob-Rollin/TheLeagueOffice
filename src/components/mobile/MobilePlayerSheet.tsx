import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { playerImage, teamLogo } from "@/components/draft/PlayerAvatar";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { usePositionalDefenseRanks } from "@/hooks/usePositionalDefenseRanks";
import type { Pos } from "@/lib/draft";
import { teamFullName } from "@/lib/nfl-teams";
import { getPlayerDetail } from "@/lib/players.functions";
import { fetchPlayerNewsClient } from "@/lib/player-news-client";
import type { SeasonLine } from "@/lib/players.server";
import { fetchPlayerDetailClient } from "@/lib/player-detail-client";
import { hydratePlayerBrain } from "@/lib/playerBrainHydration";
import { fetchResearchFpa } from "@/lib/research-cdn";
import { formatNflKickoffLabel } from "@/lib/rolling-live-projection";
import { injuryBadgeInfo } from "@/lib/injury-badge";
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
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: () => open(id),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open(id);
      }
    },
  };
}

export function MobilePlayerSheetProvider({ children }: { children: ReactNode }) {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const close = useCallback(() => setPlayerId(null), []);
  return (
    <MobilePlayerContext.Provider value={setPlayerId}>
      {children}
      {playerId ? <MobilePlayerSheet id={playerId} onClose={close} /> : null}
    </MobilePlayerContext.Provider>
  );
}

const AVATAR_POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

function MobilePlayerSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const [tab, setTab] = useState<"overview" | "stats" | "logs">("overview");

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

  const detail = useQuery({
    queryKey: ["player", id, "client-v1"],
    queryFn: async () => {
      const brain = await hydratePlayerBrain().catch(() => null);
      const client = await fetchPlayerDetailClient(id, brain);
      if (client) return client;
      try {
        if (import.meta.env.PROD) return null;
      } catch {
        /* ignore */
      }
      return getPlayerDetail({ data: { id } });
    },
    staleTime: HOUR,
    retry: false,
  });
  const { data: bio } = useQuery({
    queryKey: ["player-bio", id],
    queryFn: () => fetchPlayerBioClient(id),
    staleTime: 12 * HOUR,
    retry: false,
  });
  const player = detail.data?.player ?? null;
  const team = player?.team && player.team !== "FA" ? player.team : null;
  const { data: nextGame } = useQuery({
    queryKey: ["player-next-game", team],
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
          {logo ? (
            <img
              src={logo}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute -right-16 -top-6 size-80 object-contain opacity-[0.07]"
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
            <p className="px-5 py-24 text-center text-sm text-m-muted">Loading player...</p>
          ) : !player ? (
            <p className="px-5 py-24 text-center text-sm text-m-muted">Player details are unavailable.</p>
          ) : (
            <div className="relative flex min-h-[220px] items-end">
              <div className="relative z-[1] min-w-0 flex-1 py-6 pl-5 pr-2">
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
                {injuryInfo ? (
                  <span
                    className={cn(
                      "mt-4 inline-block rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wide",
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
                    "relative z-[1] shrink-0 object-contain object-bottom",
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
                  ["stats", "Stats"],
                  ["logs", "Game Log"],
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
              />
            ) : tab === "stats" ? (
              <StatsTab
                id={id}
                team={team}
                pos={player.pos}
                format={format}
                seasonToDate={detail.data?.seasonToDate ?? null}
                projection={detail.data?.projection ?? null}
                history={detail.data?.history ?? []}
              />
            ) : (
              <GameLogTab id={id} team={team} pos={player.pos} format={format} />
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

function Overview({
  id,
  pos,
  team,
  nextGame,
  projected,
  sosGrade,
}: {
  id: string;
  pos: string;
  team: string | null;
  nextGame: Awaited<ReturnType<typeof fetchNextGameClient>> | null;
  projected: number | null;
  sosGrade: string | null;
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

type Format = "std" | "half" | "ppr";
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

type SeasonRow = { label: string; line: SeasonLine };

function StatsTab({
  id,
  team,
  pos,
  format,
  seasonToDate,
  projection,
  history,
}: {
  id: string;
  team: string | null;
  pos: string;
  format: Format;
  seasonToDate: SeasonLine | null;
  projection: SeasonLine | null;
  history: SeasonLine[];
}) {
  const statCols = POS_STAT_COLS[pos] ?? POS_STAT_COLS["WR"]!;
  const actual: SeasonRow[] = [
    ...(seasonToDate ? [{ label: seasonToDate.season, line: seasonToDate }] : []),
    ...history.filter((h) => h.season !== seasonToDate?.season).map((h) => ({ label: h.season, line: h })),
  ];
  const cols: TableCol<SeasonRow>[] = [
    { key: "fpts", label: "Fpts", highlight: true, render: (r) => r.line.points[format].toFixed(1) },
    {
      key: "avg",
      label: "Avg",
      render: (r) => (r.line.games ? (r.line.points[format] / r.line.games).toFixed(1) : "-"),
    },
    { key: "gp", label: "GP", render: (r) => (r.line.games ? String(r.line.games) : "-") },
    { key: "rank", label: "Pos Rk", render: (r) => (r.line.posRank ? String(r.line.posRank) : "-") },
    ...statCols.map((c) => ({ key: c.key, label: c.label, render: (r: SeasonRow) => statValue(r.line.raw, c.key) })),
  ];
  const lead: TableCol<SeasonRow> = { key: "season", label: "Season", render: (r) => r.label };

  return (
    <>
      {!actual.length && !projection ? (
        <p className="px-4 py-8 text-center text-sm text-m-muted">No season stats available yet.</p>
      ) : null}
      {actual.length ? <StatTable title="Season Stats" lead={lead} cols={cols} rows={actual} rowKey={(r) => r.label} /> : null}
      {projection ? (
        <StatTable
          title="Projection"
          lead={lead}
          cols={cols.filter((c) => c.key !== "rank")}
          rows={[{ label: projection.season, line: projection }]}
          rowKey={(r) => r.label}
        />
      ) : null}
      <WeeklyProjections id={id} team={team} pos={pos} format={format} />
    </>
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

/** Season weeks with a Sleeper projected line (played + upcoming). */
function WeeklyProjections({
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
  // Include past weeks that have a proj line (game-log / proj tab parity).
  const weeks = (data?.logs ?? []).filter(
    (l) => l.isBye || l.proj != null || (l.projRaw && Object.keys(l.projRaw).length > 0) || !l.played,
  );

  if (isLoading) return <p className="px-4 py-6 text-center text-sm text-m-muted">Loading weekly projections...</p>;
  if (!weeks.length) return null;

  type Log = (typeof weeks)[number];
  const statCols = POS_STAT_COLS[pos] ?? POS_STAT_COLS["WR"]!;
  const cols: TableCol<Log>[] = [
    { key: "opp", label: "Opp", render: (l) => (l.isBye ? "BYE" : (l.opp ?? "-")) },
    {
      key: "proj",
      label: "Proj",
      highlight: true,
      render: (l) => (l.isBye || l.proj?.[format] == null ? "-" : l.proj[format]!.toFixed(1)),
    },
    ...statCols.map((c) => ({
      key: c.key,
      label: c.label,
      render: (l: Log) => (l.isBye || !l.projRaw ? "-" : statValue(l.projRaw, c.key)),
    })),
  ];

  return (
    <StatTable
      title="Weekly Projections"
      lead={{ key: "week", label: "Week", render: (l) => `Week ${l.week}` }}
      cols={cols}
      rows={weeks}
      rowKey={(l) => String(l.week)}
    />
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

