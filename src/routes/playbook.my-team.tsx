import { PlayerAvatar, playerImage, teamLogo } from "@/components/draft/PlayerAvatar";
import { PositionBadge } from "@/components/draft/PositionBadge";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import { INJURY_STATUS_LABEL, InjuryReportCard } from "@/components/injury/InjuryReportCard";
import { SosStars } from "@/components/sos/SosStars";
import { TeamOverview } from "@/components/team/TeamOverview";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useActiveMatchups } from "@/hooks/useActiveMatchups";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useLeagueRosters, type ResolvedRosterTeam } from "@/hooks/useLeagueRosters";
import { useNflGameProgress } from "@/hooks/useNflGameProgress";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { usePositionalDefenseRanks } from "@/hooks/usePositionalDefenseRanks";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { useWeeklyActualStats } from "@/hooks/useWeeklyActualStats";
import type { Player, Pos } from "@/lib/draft";
import { getInjuryReports, getRosterNews } from "@/lib/players.functions";
import type { InjuryReportItem } from "@/lib/players.server";
import { getTeamPrimaryColor } from "@/lib/nfl-teams";
import {
  currentSeason,
  fetchSchedule,
  type ScheduleGame,
} from "@/lib/players-build";
import { starterRequirements } from "@/lib/power-rankings";
import {
  formatNflGameStatusLabel,
  formatNflKickoffLabel,
  type NflGameProgress,
} from "@/lib/rolling-live-projection";
import { injuryMicroBadge, resolveInjuryStatus } from "@/lib/sandbox-rosters";
import { hasScorableProjectionStats, scoreStats, type ScoringMap } from "@/lib/scoring-map";
import { getCached } from "@/lib/sleeper-cache";
import { sosStarsFromRank, weeklySosMatchupFor, type SosMatchup } from "@/lib/sos-presentation";
import { cn } from "@/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

export const Route = createFileRoute("/playbook/my-team")({
  ssr: false,
  head: () => ({
    meta: [{ title: "My Team — Playbook" }],
  }),
  component: PlaybookMyTeamPage,
});

type TeamTab = "overview" | "lineup" | "projections" | "statistics" | "news";

const TABS: { id: TeamTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "lineup", label: "Lineup" },
  { id: "projections", label: "Projections" },
  { id: "statistics", label: "Statistics" },
  { id: "news", label: "News" },
];

const SKIP_STARTER_SLOTS = new Set(["BN", "BENCH", "IR", "IL", "TAXI", "RESERVE"]);
const FLEX_OK = new Set(["RB", "WR", "TE"]);
/** Never invent a weekly proj from season averages — Sleeper shows "—" instead. */
const weeklyFallback = (_p: Player) => 0;

/** Sleeper ↔ ESPN abbreviation aliases for scoreboard lookups. */
const TEAM_PROGRESS_ALIASES: Record<string, string[]> = {
  WAS: ["WAS", "WSH"],
  WSH: ["WSH", "WAS"],
  LAR: ["LAR", "LA"],
  LA: ["LA", "LAR"],
  JAC: ["JAC", "JAX"],
  JAX: ["JAX", "JAC"],
};

const SCHEDULE_CACHE_KEY = "schedule-v1";
const DAY_MS = 24 * 60 * 60 * 1000;

type RosterRow = {
  slot: string;
  player: Player | null;
};

type ScheduleSosRow = SosMatchup & { isAway: boolean };

const thClass =
  "px-3 py-1.5 text-left text-[10px] font-black uppercase tracking-wider text-slate-500";
const thRightClass =
  "px-3 py-1.5 text-right text-[10px] font-black uppercase tracking-wider text-slate-500";

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
): RosterRow[] {
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
  return labels.map((slot) => {
    const match = pool.find((p) => {
      if (used.has(p.id)) return false;
      if (slot === "FLEX") return FLEX_OK.has(p.pos);
      return p.pos === slot;
    });
    if (match) used.add(match.id);
    return { slot, player: match?.player ?? null };
  });
}

function posRankLabel(player: Player, sleeperPosRank?: number | null): string {
  const rank =
    sleeperPosRank != null && Number.isFinite(sleeperPosRank) && sleeperPosRank > 0
      ? sleeperPosRank
      : Number(player.posRank);
  if (!Number.isFinite(rank) || rank <= 0 || rank >= 999) return `${player.pos}-`;
  return `${player.pos}${Math.round(rank)}`;
}

function progressForPlayer(
  player: Player,
  progressByNflTeam: Map<string, NflGameProgress>,
): NflGameProgress | undefined {
  const nfl = (player.team || "").trim().toUpperCase();
  if (!nfl || nfl === "FA") return undefined;
  const keys = TEAM_PROGRESS_ALIASES[nfl] ?? [nfl];
  for (const key of keys) {
    const hit = progressByNflTeam.get(key);
    if (hit) return hit;
  }
  return undefined;
}

async function loadScheduleGames(): Promise<ScheduleGame[]> {
  try {
    const payload = await getCached<{ season: string; games: ScheduleGame[] }>(
      SCHEDULE_CACHE_KEY,
      DAY_MS,
      async () => {
        const season = currentSeason();
        return { season, games: await fetchSchedule(season) };
      },
    );
    return payload?.games ?? [];
  } catch {
    return [];
  }
}

/** Opponents from the NFL schedule — ranks stay null (brain supplies positional SOS). */
function buildScheduleOppByTeam(games: ScheduleGame[]): Map<string, ScheduleSosRow[]> {
  const byTeam = new Map<string, ScheduleSosRow[]>();
  for (const g of games) {
    const home = (g.home || "").toUpperCase();
    const away = (g.away || "").toUpperCase();
    if (!g.week || g.week > 18) continue;
    if (home) {
      const rows = byTeam.get(home) ?? [];
      rows.push({
        week: g.week,
        opp: away,
        rank: null,
        pointsAllowed: null,
        isAway: false,
      });
      byTeam.set(home, rows);
    }
    if (away) {
      const rows = byTeam.get(away) ?? [];
      rows.push({
        week: g.week,
        opp: home,
        rank: null,
        pointsAllowed: null,
        isAway: true,
      });
      byTeam.set(away, rows);
    }
  }
  for (const [team, rows] of byTeam) {
    byTeam.set(
      team,
      [...rows].sort((a, b) => a.week - b.week),
    );
  }
  return byTeam;
}

/**
 * Compact injury chip from the already-loaded Sleeper catalog — no per-slot
 * `detailQuery` / Sleeper fan-out on My Team remounts.
 */
function RowInjuryBadge({
  player,
  onOpen,
}: {
  player: Player;
  onOpen: () => void;
}) {
  const badge = injuryMicroBadge(resolveInjuryStatus(player));
  if (!badge) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      aria-label={`${player.name} injury status ${badge.label}`}
      className={cn(
        "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[2px] px-1 text-[9px] font-bold text-white transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        badge.className,
      )}
    >
      {badge.label}
    </button>
  );
}

function WeekSelector({
  week,
  maxWeek = 18,
  onChange,
}: {
  week: number;
  maxWeek?: number;
  onChange: (week: number) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-1 py-0.5 shadow-sm">
      <button
        type="button"
        aria-label="Previous week"
        disabled={week <= 1}
        onClick={() => onChange(Math.max(1, week - 1))}
        className="flex h-7 w-7 items-center justify-center rounded-md text-sm font-semibold text-primary transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
      >
        {"<"}
      </button>
      <span className="min-w-[4.5rem] text-center text-xs font-bold tabular-nums text-slate-700">
        Week {week}
      </span>
      <button
        type="button"
        aria-label="Next week"
        disabled={week >= maxWeek}
        onClick={() => onChange(Math.min(maxWeek, week + 1))}
        className="flex h-7 w-7 items-center justify-center rounded-md text-sm font-semibold text-primary transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
      >
        {">"}
      </button>
    </div>
  );
}

function playerByeMeta(player: Player): string {
  const team = (player.team || "FA").trim().toUpperCase() || "FA";
  const bye =
    player.bye != null && Number.isFinite(Number(player.bye))
      ? String(Math.round(Number(player.bye)))
      : "-";
  return `${team} — BYE: ${bye}`;
}

function newsTimeAgo(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.max(1, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return mins === 1 ? "1 minute ago" : `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs === 1 ? "1 hour ago" : `${hrs} hours ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function PlayerNewsCell({
  headline,
  description,
  link,
  loading,
}: {
  headline: string | null;
  description: string | null;
  link: string | null;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (loading) {
    return <span className="text-xs text-slate-400">Loading…</span>;
  }
  if (!headline) {
    return <span className="text-xs text-slate-400">No recent notes</span>;
  }

  if (link) {
    return (
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        className="line-clamp-2 max-w-md cursor-pointer text-xs leading-snug text-slate-600 transition-colors hover:text-blue-600"
      >
        {headline}
      </a>
    );
  }

  return (
    <div className="relative max-w-md">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="line-clamp-2 cursor-pointer text-left text-xs leading-snug text-slate-600 transition-colors hover:text-blue-600"
      >
        {headline}
      </button>
      {open && description ? (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-md border border-border bg-white p-3 text-xs leading-relaxed text-slate-600 shadow-md">
          {description}
        </div>
      ) : null}
    </div>
  );
}

const sectionBannerClass =
  "text-xs font-black uppercase tracking-wider text-slate-900 bg-slate-100/60 p-2 w-full block mb-2";

const OFFENSE_POS = new Set(["QB", "RB", "WR", "TE"]);
const OFFENSE_POS_ORDER: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3 };

function fmtProjStat(
  stats: Record<string, number> | null | undefined,
  key: string,
  digits = 0,
): string {
  const raw = stats?.[key];
  if (raw == null || !Number.isFinite(Number(raw))) return "-";
  const n = Number(raw);
  return digits > 0 ? n.toFixed(digits) : String(Math.round(n));
}

const PTS_ALLOW_TIERS: [max: number, key: string][] = [
  [0, "pts_allow_0"],
  [6, "pts_allow_1_6"],
  [13, "pts_allow_7_13"],
  [20, "pts_allow_14_20"],
  [27, "pts_allow_21_27"],
  [34, "pts_allow_28_34"],
  [Infinity, "pts_allow_35p"],
];

/** Fantasy points for a weekly box score in league scoring; null when the player has no line. */
function scoreActualLine(
  stats: Record<string, number> | null,
  map: ScoringMap,
): number | null {
  if (!stats) return null;
  let line = stats;
  const allowed = Number(stats["pts_allow"]);
  const hasTier = PTS_ALLOW_TIERS.some(([, key]) => Number(stats[key]) > 0);
  // Some defense lines only carry the points-allowed total, not its tier flag.
  if (Number.isFinite(allowed) && !hasTier) {
    const tier = PTS_ALLOW_TIERS.find(([max]) => allowed <= max)?.[1];
    if (tier) line = { ...stats, [tier]: 1 };
  }
  const pts = scoreStats(line, map);
  return pts == null ? null : Math.round(pts * 100) / 100;
}

/** Live stats: empty / missing / zero → dash. Pre-kickoff forces dash regardless. */
function fmtActualStat(
  stats: Record<string, number> | null | undefined,
  key: string,
  digits = 0,
  gameLive = true,
): string {
  if (!gameLive) return "-";
  const raw = stats?.[key];
  if (raw == null || !Number.isFinite(Number(raw))) return "-";
  const n = Number(raw);
  if (n === 0) return "-";
  return digits > 0 ? n.toFixed(digits) : String(Math.round(n));
}

function fmtFga(stats: Record<string, number> | null | undefined): string {
  if (stats?.["fga"] != null && Number.isFinite(Number(stats["fga"]))) {
    return String(Math.round(Number(stats["fga"])));
  }
  const made = Number(stats?.["fgm"] ?? NaN);
  const miss = Number(stats?.["fgmiss"] ?? NaN);
  if (Number.isFinite(made) && Number.isFinite(miss)) {
    return String(Math.round(made + miss));
  }
  return "-";
}

function fmtActualFga(
  stats: Record<string, number> | null | undefined,
  gameLive = true,
): string {
  if (!gameLive) return "-";
  const label = fmtFga(stats);
  if (label === "-" || label === "0") return "-";
  return label;
}

function ProjectionPlayerCell({
  player,
  onOpen,
}: {
  player: Player;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(player.id)}
      className="flex min-w-0 items-center gap-3 text-left transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <PlayerAvatar
        id={player.id}
        pos={player.pos}
        team={player.team}
        name={player.name}
        className="size-9"
        logoClassName="size-3"
      />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-semibold text-slate-900">{player.name}</span>
          <RowInjuryBadge player={player} onOpen={() => onOpen(player.id)} />
        </span>
        <span className="mt-0.5 block truncate text-[11px] font-medium uppercase text-slate-400">
          {playerByeMeta(player)}
        </span>
      </span>
    </button>
  );
}

type RosterNewsItem = {
  id: string;
  /** Owning sleeper id — must equal the roster player's id before render. */
  playerId: string;
  headline: string;
  description: string;
  link: string | null;
  published: string;
  source: string;
};

function SidebarInjuryLetter({ short }: { short: string }) {
  return (
    <span
      className={cn(
        "mr-1.5 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[2px] px-1 text-[9px] font-bold text-white",
        short === "Q" ? "bg-amber-500/80" : short === "D" || short === "PUP" ? "bg-orange-500/80" : "bg-rose-600/80",
      )}
    >
      {short === "OUT" ? "O" : short}
    </span>
  );
}

/** Strip punctuation / suffixes so A.J. Brown and AJ Brown resolve the same. */
const sanitizePlayerName = (name: string) => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/(jr|sr|iii|ii|iv)$/g, "")
    .trim();
};

/** Headline/body must reference this exact roster player — blocks adjacent-row bleed. */
function newsCopyBelongsToPlayer(
  player: Player,
  item: { headline?: string | null; description?: string | null },
): boolean {
  const hay = sanitizePlayerName(`${item.headline ?? ""} ${item.description ?? ""}`);
  if (!hay) return false;
  const full = sanitizePlayerName(player.name);
  if (full && hay.includes(full)) return true;
  const parts = player.name
    .replace(/\./g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 2) return false;
  const first = sanitizePlayerName(parts[0]!);
  const last = sanitizePlayerName(parts[parts.length - 1]!);
  return Boolean(first && last && last.length >= 3 && hay.includes(first) && hay.includes(last));
}

const GOOFY_NEWS_COPY_RE =
  /^(c\.?j\.?|or so they say\.?\.?\.?|fortune favors the bold\.?|no full report available yet\.?|player update\.?)$/i;

const GOOFY_NEWS_FRAGMENT_RE =
  /\bor so they say\b|\bfortune favors the bold\b|\bcheck back later\b|\blorem ipsum\b/i;

/** Reject short initials, proverb fluff, and copy that names a different player. */
function isGoofyOrMismatchedCopy(player: Player, text: string | null | undefined): boolean {
  const raw = (text ?? "").trim();
  if (!raw) return true;
  if (raw.length < 18) return true;
  if (GOOFY_NEWS_COPY_RE.test(raw)) return true;
  if (GOOFY_NEWS_FRAGMENT_RE.test(raw)) return true;
  // Bare initialisms like "C.J." as the entire body.
  if (/^[A-Z]\.?[A-Z]\.?\.?$/.test(raw)) return true;
  // If copy mentions a full other-looking name but not this player, reject.
  if (!newsCopyBelongsToPlayer(player, { headline: raw, description: "" })) {
    // Allow impact sentences that are generic coaching advice without a name.
    const looksNamed = /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(raw);
    if (looksNamed) return true;
  }
  return false;
}

const SLEEPER_INJURY_SHORT: Record<string, string> = {
  questionable: "Q",
  doubtful: "D",
  out: "OUT",
  ir: "IR",
  pup: "PUP",
  sus: "SUSP",
  suspended: "SUSP",
  na: "NA",
  dnr: "DNR",
  cov: "COV",
};

/** Sleeper designation in the injury report's short form; "" when healthy. */
function injuryShortFor(player: Player): string {
  const raw = (player.injury_status ?? player.injury ?? "").trim().toLowerCase();
  if (!raw || raw === "healthy" || raw === "active" || raw === "none") return "";
  return SLEEPER_INJURY_SHORT[raw] ?? raw.toUpperCase().slice(0, 4);
}

/** RotoWire blurbs lead with the news sentence; the rest is their fantasy analysis. */
function splitRosterNews(item: RosterNewsItem): { news: string; analysis: string | null } {
  const raw = item.description.trim();
  const marker = /fantasy\s*impact\s*:/i.exec(raw);
  if (marker) {
    return {
      news: raw.slice(0, marker.index).trim(),
      analysis: raw.slice(marker.index + marker[0].length).trim() || null,
    };
  }
  if (item.source === "RotoWire") {
    const [first, ...rest] = raw.split(/(?<=[.!?])\s+/);
    return { news: first ?? raw, analysis: rest.join(" ").trim() || null };
  }
  return { news: raw, analysis: null };
}

/** Roster news in the injury report card shape so both pages share one card. */
function rosterNewsCard(player: Player, item: RosterNewsItem): InjuryReportItem {
  const short = injuryShortFor(player);
  const { news, analysis } = splitRosterNews(item);
  return {
    id: `news-${player.id}-${item.id}`,
    sleeperId: player.id,
    playerName: player.name,
    pos: player.pos,
    team: player.team && player.team !== "FA" ? player.team : null,
    headshot: null,
    status: short ? (INJURY_STATUS_LABEL[short] ?? short) : "Active",
    statusShort: short,
    injury: player.injury_body_part ?? null,
    headline: item.headline,
    news,
    analysis,
    published: item.published,
    returnDate: null,
    link: item.link,
    source: item.source,
    sourceStatusShort: null,
    sourceStatus: null,
  };
}

function clipSnippet(text: string, max = 96): string {
  const raw = text.trim();
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max).replace(/\s+\S*$/, "")}...`;
}

function isIdpOrDefensivePos(pos: string | null | undefined): boolean {
  const p = (pos ?? "").trim().toUpperCase();
  return (
    p === "DEF" ||
    p === "DST" ||
    p === "DL" ||
    p === "LB" ||
    p === "DB" ||
    p === "DE" ||
    p === "DT" ||
    p === "CB" ||
    p === "S" ||
    p === "IDP"
  );
}

function SidebarPlayerThumb({
  resolved,
  row,
}: {
  resolved: Player | null;
  row: Pick<InjuryReportItem, "sleeperId" | "pos" | "team">;
}) {
  const pos = (resolved?.pos ?? row.pos ?? "").toUpperCase();
  const team = (resolved?.team ?? row.team ?? "").trim();
  const logo = team ? teamLogo(team) : null;
  const headshotCandidate =
    resolved
      ? playerImage(resolved.id, resolved.pos, resolved.team)
      : row.sleeperId && row.pos
        ? playerImage(row.sleeperId, row.pos as Pos, row.team ?? "")
        : "";
  const isDefensiveOrMissing = !headshotCandidate || isIdpOrDefensivePos(pos);
  const imageSrc = isDefensiveOrMissing ? logo ?? "" : headshotCandidate;
  const [src, setSrc] = useState(imageSrc);
  const showingLogo = Boolean(logo && src === logo);

  useEffect(() => {
    setSrc(isDefensiveOrMissing ? logo ?? "" : headshotCandidate);
  }, [isDefensiveOrMissing, headshotCandidate, logo]);

  if (!src) {
    return <span className="h-7 w-7 flex-shrink-0 rounded-full bg-slate-50" aria-hidden="true" />;
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className={cn(
        "h-7 w-7 flex-shrink-0 rounded-full bg-slate-50",
        showingLogo || isDefensiveOrMissing ? "object-contain" : "object-cover",
      )}
      onError={() => {
        if (logo && src !== logo) setSrc(logo);
        else setSrc("");
      }}
    />
  );
}

const SIDEBAR_ROWS = 12;

/**
 * Left: news for this user's roster in the Injury Reports card style.
 * Right: the latest league-wide injury reports, linking to the full Injury Reports page.
 */
function MyTeamNewsPanel({
  feed,
  feedLoading,
  sidebar,
  sidebarLoading,
  players,
  onOpenPlayer,
}: {
  feed: InjuryReportItem[];
  feedLoading: boolean;
  sidebar: InjuryReportItem[];
  sidebarLoading: boolean;
  players: Player[];
  onOpenPlayer: (id: string) => void;
}) {
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const sidebarTrack = sidebar.slice(0, SIDEBAR_ROWS);

  return (
    <div className="grid w-full grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_320px]">
      <section className="min-w-0 w-full" aria-label="Team news feed">
        {feed.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <p className="px-5 py-10 text-center text-sm text-slate-400">
              {feedLoading ? "Loading your team's news…" : "No recent news for players on your team."}
            </p>
          </div>
        ) : (
          <ul className="space-y-4">
            {feed.map((item) => (
              <InjuryReportCard
                key={item.id}
                item={item}
                owner={null}
                showOwnership={false}
                onOpen={onOpenPlayer}
              />
            ))}
          </ul>
        )}
      </section>

      <aside
        className="w-full min-w-0 self-start text-left lg:sticky lg:top-4"
        aria-label="Player injury news"
      >
        <div className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm">
          <h2 className="mb-3 border-b border-slate-100 pb-2.5 text-sm font-bold uppercase tracking-wide text-slate-900">
            Player Injury News
          </h2>
          <div className="w-full">
            {sidebarLoading && sidebarTrack.length === 0
              ? Array.from({ length: 10 }, (_, i) => (
                  <div
                    key={`sidebar-skel-${i}`}
                    className="flex w-full items-center space-x-3 border-b border-slate-50 py-2 last:border-0"
                  >
                    <div className="h-7 w-7 flex-shrink-0 rounded-full bg-slate-100" />
                    <div className="h-3 flex-1 rounded bg-slate-100" />
                  </div>
                ))
              : sidebarTrack.length === 0
                ? (
                    <p className="py-2 text-xs text-slate-400">No active injury reports yet.</p>
                  )
                : sidebarTrack.map((row) => {
                    const resolved = row.sleeperId ? (playersById.get(row.sleeperId) ?? null) : null;
                    const openId = row.sleeperId;
                    const ago = newsTimeAgo(row.published);
                    const snippet = clipSnippet(row.news || row.headline);
                    return (
                      <div
                        key={row.id}
                        className="flex w-full items-start space-x-3 border-b border-slate-50 py-2 last:border-0"
                      >
                        {openId ? (
                          <button
                            type="button"
                            onClick={() => onOpenPlayer(openId)}
                            className="mt-0.5 flex-shrink-0"
                            aria-label={`Open ${row.playerName}`}
                          >
                            <SidebarPlayerThumb resolved={resolved} row={row} />
                          </button>
                        ) : (
                          <span className="mt-0.5 flex-shrink-0">
                            <SidebarPlayerThumb resolved={resolved} row={row} />
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="text-xs leading-tight text-slate-700">
                            {openId ? (
                              <button
                                type="button"
                                onClick={() => onOpenPlayer(openId)}
                                className="mr-1.5 text-xs font-black text-slate-900 hover:text-blue-600"
                              >
                                {row.playerName}
                              </button>
                            ) : (
                              <span className="mr-1.5 text-xs font-black text-slate-900">{row.playerName}</span>
                            )}
                            {row.statusShort ? <SidebarInjuryLetter short={row.statusShort} /> : null}
                            {row.link ? (
                              <a
                                href={row.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-slate-700 transition-colors hover:text-blue-600"
                              >
                                {snippet}
                              </a>
                            ) : (
                              <span className="text-xs text-slate-700">{snippet}</span>
                            )}
                          </p>
                          {ago ? <span className="mt-0.5 block text-[10px] text-slate-400">{ago}</span> : null}
                        </div>
                      </div>
                    );
                  })}
          </div>
          <Link
            to="/injury-reports"
            className="block cursor-pointer pt-2 text-center text-xs font-bold tracking-wide text-blue-600 hover:text-blue-800"
          >
            View All News
          </Link>
        </div>
      </aside>
    </div>
  );
}

function PlaybookMyTeamPage() {
  const { activeLeague, activeLeagueId } = useActiveLeague();
  const { data: playersPayload, loading: playersLoading } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const { myTeam, rosterPositions, loading: rostersLoading } = useLeagueRosters(players);
  const brain = usePlayerBrain();
  const { rankFor: positionalDefenseRank } = usePositionalDefenseRanks();
  const modalRef = useRef<PlayerModalHandle>(null);
  const [tab, setTab] = useState<TeamTab>(() => {
    if (typeof window === "undefined") return "overview";
    const saved = window.sessionStorage.getItem("playbook-my-team-tab");
    if (
      saved === "overview" ||
      saved === "lineup" ||
      saved === "projections" ||
      saved === "statistics" ||
      saved === "news"
    ) {
      return saved;
    }
    return "overview";
  });
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [scheduleSosByTeam, setScheduleSosByTeam] = useState<Map<string, ScheduleSosRow[]>>(
    () => new Map(),
  );

  useEffect(() => {
    window.sessionStorage.setItem("playbook-my-team-tab", tab);
  }, [tab]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const games = await loadScheduleGames();
      if (!alive) return;
      setScheduleSosByTeam(buildScheduleOppByTeam(games));
    })().catch(() => {
      /* silent */
    });
    return () => {
      alive = false;
    };
  }, []);

  const nflWeek = useQuery({
    queryKey: ["nfl-state-week", "v3-week"],
    staleTime: 30 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const res = await fetch("https://api.sleeper.app/v1/state/nfl", {
        headers: { accept: "application/json" },
      }).catch(() => null);
      const json = res && res.ok ? ((await res.json()) as Record<string, unknown>) : null;
      return Math.max(1, Number(json?.["week"] ?? 1) || 1);
    },
  });

  useEffect(() => {
    if (nflWeek.data != null) setSelectedWeek(nflWeek.data);
  }, [nflWeek.data, activeLeagueId]);

  const activeWeek = selectedWeek ?? nflWeek.data ?? 1;
  const {
    projectFor,
    statsFor,
    rankFor,
    scoringMap,
    loading: projectionsLoading,
  } = useLeagueProjections(activeWeek);
  const { statsFor: actualStatsFor } = useWeeklyActualStats(activeWeek);
  const { matchups, loading: matchupsLoading } = useActiveMatchups(activeWeek);
  const { progressByNflTeam } = useNflGameProgress(activeWeek);

  const starterRows = useMemo(() => {
    if (!myTeam) return [] as RosterRow[];
    return buildStarterRows(myTeam, rosterPositions, projectFor);
  }, [myTeam, rosterPositions, projectFor]);

  const starterIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of starterRows) if (row.player) ids.add(row.player.id);
    return ids;
  }, [starterRows]);

  const benchRows = useMemo(() => {
    if (!myTeam) return [] as RosterRow[];
    const irIds = new Set((myTeam.ir ?? []).map((p) => p.id));
    return (myTeam.bench ?? [])
      .filter((p) => !starterIds.has(p.id) && !irIds.has(p.id))
      .map((p) => ({ slot: "BN", player: p }));
  }, [myTeam, starterIds]);

  const irRows = useMemo(() => {
    if (!myTeam) return [] as RosterRow[];
    return (myTeam.ir ?? []).map((p) => ({ slot: "IR", player: p }));
  }, [myTeam]);

  const allRows = useMemo(
    () => [...starterRows, ...benchRows, ...irRows],
    [starterRows, benchRows, irRows],
  );

  /** Starters + bench only (no IR) for Projections section filters. */
  const projectionSourceRows = useMemo(() => {
    const seen = new Set<string>();
    const out: RosterRow[] = [];
    for (const row of [...starterRows, ...benchRows]) {
      if (!row.player) continue;
      if (seen.has(row.player.id)) continue;
      seen.add(row.player.id);
      out.push(row);
    }
    return out;
  }, [starterRows, benchRows]);

  const offensiveProjRows = useMemo(() => {
    return projectionSourceRows
      .filter((r) => r.player && OFFENSE_POS.has(r.player.pos))
      .slice()
      .sort((a, b) => {
        const pa = a.player!;
        const pb = b.player!;
        const groupDelta =
          (OFFENSE_POS_ORDER[pa.pos] ?? 99) - (OFFENSE_POS_ORDER[pb.pos] ?? 99);
        if (groupDelta !== 0) return groupDelta;
        const ptsA = projectFor(pa.id) ?? weeklyFallback(pa);
        const ptsB = projectFor(pb.id) ?? weeklyFallback(pb);
        return ptsB - ptsA;
      });
  }, [projectionSourceRows, projectFor]);

  const kickerProjRows = useMemo(
    () => projectionSourceRows.filter((r) => r.player?.pos === "K"),
    [projectionSourceRows],
  );

  const defensiveProjRows = useMemo(
    () =>
      projectionSourceRows.filter((r) => {
        const pos = (r.player?.pos ?? "").toUpperCase();
        return pos === "DEF" || pos === "DST";
      }),
    [projectionSourceRows],
  );

  const rosteredPlayers = useMemo(() => {
    const out: Player[] = [];
    const seen = new Set<string>();
    for (const row of allRows) {
      if (!row.player || seen.has(row.player.id)) continue;
      seen.add(row.player.id);
      out.push(row.player);
    }
    return out;
  }, [allRows]);

  const myPlayerPoints = useMemo(() => {
    const entries = matchups?.entries ?? [];
    const myRosterId = myTeam?.slot ?? null;
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const mine =
      (myRosterId != null
        ? entries.find((row) => Number(row.rosterId) === Number(myRosterId))
        : null) ??
      entries.find(
        (row) =>
          Boolean(activeLeague?.teamName) &&
          norm(row.teamName) === norm(activeLeague?.teamName ?? ""),
      ) ??
      entries.find(
        (row) => Boolean(myTeam?.team) && norm(row.teamName) === norm(myTeam?.team ?? ""),
      ) ??
      null;
    return (mine?.playerPoints ?? {}) as Record<string, number>;
  }, [matchups, myTeam, activeLeague?.teamName]);

  /**
   * The host's matchup only carries players rostered that week, so anyone added
   * later is scored from his box score with the league's settings.
   */
  const boxScorePoints = useMemo(() => {
    const map = new Map<string, number>();
    for (const player of rosteredPlayers) {
      const pts = scoreActualLine(actualStatsFor(player.id), scoringMap);
      if (pts != null) map.set(player.id, pts);
    }
    return map;
  }, [rosteredPlayers, actualStatsFor, scoringMap]);

  const livePtsOf = (player: Player): number => {
    const host = Number(myPlayerPoints[player.id]);
    if (myPlayerPoints[player.id] != null && Number.isFinite(host)) return host;
    return boxScorePoints.get(player.id) ?? 0;
  };

  const offensiveStatRows = useMemo(() => {
    return projectionSourceRows
      .filter((r) => r.player && OFFENSE_POS.has(r.player.pos))
      .slice()
      .sort((a, b) => {
        const pa = a.player!;
        const pb = b.player!;
        const groupDelta =
          (OFFENSE_POS_ORDER[pa.pos] ?? 99) - (OFFENSE_POS_ORDER[pb.pos] ?? 99);
        if (groupDelta !== 0) return groupDelta;
        return livePtsOf(pb) - livePtsOf(pa);
      });
  }, [projectionSourceRows, myPlayerPoints, boxScorePoints]);

  const kickerStatRows = useMemo(
    () =>
      projectionSourceRows
        .filter((r) => r.player?.pos === "K")
        .slice()
        .sort((a, b) => livePtsOf(b.player!) - livePtsOf(a.player!)),
    [projectionSourceRows, myPlayerPoints, boxScorePoints],
  );

  const defensiveStatRows = useMemo(
    () =>
      projectionSourceRows
        .filter((r) => {
          const pos = (r.player?.pos ?? "").toUpperCase();
          return pos === "DEF" || pos === "DST";
        })
        .slice()
        .sort((a, b) => livePtsOf(b.player!) - livePtsOf(a.player!)),
    [projectionSourceRows, myPlayerPoints, boxScorePoints],
  );

  const rosterIdsKey = useMemo(
    () => rosteredPlayers.map((p) => p.id).filter(Boolean).sort().join(","),
    [rosteredPlayers],
  );

  const rosterNewsQuery = useQuery({
    queryKey: ["roster-news", rosterIdsKey],
    enabled: rosterIdsKey.length > 0 && (tab === "lineup" || tab === "news"),
    staleTime: 1000 * 60 * 10,
    retry: false,
    queryFn: async () => await getRosterNews({ data: { ids: rosterIdsKey.split(",") } }),
  });

  const newsById = useMemo(() => {
    const map = new Map<
      string,
      {
        headline: string | null;
        description: string | null;
        link: string | null;
        published: string | null;
        injuryNote: string | null;
        items: RosterNewsItem[];
        loading: boolean;
      }
    >();
    const loading = rosterNewsQuery.isLoading;
    for (const p of rosteredPlayers) {
      map.set(p.id, {
        headline: null,
        description: null,
        link: null,
        published: null,
        injuryNote: null,
        items: [],
        loading,
      });
    }
    for (const entry of rosterNewsQuery.data?.players ?? []) {
      const player = rosteredPlayers.find((p) => p.id === entry.id);
      if (!player) continue;
      const items: RosterNewsItem[] = entry.news
        ? [
            {
              id: `${entry.id}-news`,
              playerId: entry.id,
              headline: entry.news.headline?.trim() || "Player update",
              description: entry.news.analysis?.trim() || "",
              link: entry.news.link?.trim() || null,
              published: entry.news.published?.trim() || "",
              source: "ESPN",
            },
          ].filter((item) => newsCopyBelongsToPlayer(player, item))
        : [];
      const top = items[0];
      map.set(entry.id, {
        headline: top?.headline ?? null,
        description: top?.description ?? null,
        link: top?.link ?? null,
        published: top?.published ?? null,
        injuryNote: entry.report?.practice?.trim() || entry.bodyPart?.trim() || null,
        items,
        loading,
      });
    }
    return map;
  }, [rosteredPlayers, rosterNewsQuery.data, rosterNewsQuery.isLoading]);

  const injuryReports = useQuery({
    queryKey: ["injury-reports"],
    queryFn: () => getInjuryReports(),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    retry: 1,
    enabled: tab === "news",
  });

  const reportBySleeperId = useMemo(() => {
    const map = new Map<string, InjuryReportItem>();
    for (const item of injuryReports.data?.items ?? []) {
      if (item.sleeperId && !map.has(item.sleeperId)) map.set(item.sleeperId, item);
    }
    return map;
  }, [injuryReports.data]);

  /** One card per rostered player: his injury report when listed, else his latest news. */
  const myTeamNews = useMemo(() => {
    const out: InjuryReportItem[] = [];
    for (const player of rosteredPlayers) {
      const report = reportBySleeperId.get(player.id);
      if (report) {
        out.push(report);
        continue;
      }
      const top = newsById
        .get(player.id)
        ?.items.find((item) => item.playerId === player.id && !isGoofyOrMismatchedCopy(player, item.headline));
      if (top) out.push(rosterNewsCard(player, top));
    }
    const at = (iso: string) => Date.parse(iso) || 0;
    return out.sort((a, b) => at(b.published) - at(a.published));
  }, [rosteredPlayers, reportBySleeperId, newsById]);

  const loading =
    playersLoading || rostersLoading || projectionsLoading || matchupsLoading || nflWeek.isLoading;

  const openPlayer = (id: string) => modalRef.current?.open(id);

  const phaseFor = (player: Player): NflGameProgress["phase"] => {
    return progressForPlayer(player, progressByNflTeam)?.phase ?? "pre";
  };

  const scheduleLabelFor = (player: Player): string => {
    const nfl = (player.team || "").trim().toUpperCase();
    if (!nfl) return "";
    if (player.bye != null && player.bye === activeWeek) return "BYE";

    const progress = progressForPlayer(player, progressByNflTeam);
    if (progress?.phase === "post") return "Final";
    if (progress?.phase === "in") {
      const live = formatNflGameStatusLabel(progress, nfl);
      return live ? live.replace(/^final$/i, "Final") : "Live";
    }

    const kickoff =
      formatNflKickoffLabel(progress?.kickoffIso) || formatNflGameStatusLabel(progress, nfl);
    if (kickoff && kickoff.toLowerCase() !== "final") return kickoff;

    const detail = (progress?.shortDetail ?? "").trim();
    if (detail) {
      return detail
        .replace(/\s+at\s+/i, " ")
        .replace(/\s+(EDT|EST|CDT|CST|MDT|MST|PDT|PST)\b/gi, "")
        .replace(/\s+(AM|PM)\b/gi, (_, m: string) => m.toUpperCase())
        .trim();
    }
    return "TBD";
  };

  const weeklySosHitFor = (
    player: Player,
  ): { stars: number | null; opp: string | null; isAway: boolean } => {
    const team = (player.team || "").trim().toUpperCase();
    const schedHit = team
      ? scheduleSosByTeam.get(team)?.find((m) => Number(m.week) === Number(activeWeek))
      : undefined;
    const progressOpp = (progressForPlayer(player, progressByNflTeam)?.opponentAbbr ?? "")
      .trim()
      .toUpperCase();

    const brainHit = weeklySosMatchupFor(brain, player.id, activeWeek);
    // Only trust brain rows with a real positional rank — null ranks rendered as 0 stars.
    if (
      brainHit &&
      brainHit.rank != null &&
      Number.isFinite(Number(brainHit.rank)) &&
      Number(brainHit.rank) > 0
    ) {
      return {
        stars: sosStarsFromRank(brainHit.rank),
        opp: (brainHit.opp ?? "").trim().toUpperCase() || progressOpp || null,
        isAway: Boolean(schedHit?.isAway),
      };
    }

    const opp =
      (brainHit?.opp ?? "").trim().toUpperCase() ||
      (schedHit?.opp ?? "").trim().toUpperCase() ||
      progressOpp ||
      null;
    const positionalRank =
      schedHit?.rank != null && Number.isFinite(Number(schedHit.rank)) && Number(schedHit.rank) > 0
        ? Number(schedHit.rank)
        : positionalDefenseRank(player.pos, opp);

    return {
      stars: sosStarsFromRank(positionalRank),
      opp,
      isAway: Boolean(schedHit?.isAway),
    };
  };

  const opponentLabelFor = (player: Player): string => {
    if (player.bye != null && player.bye === activeWeek) return "BYE";
    const hit = weeklySosHitFor(player);
    if (!hit.opp) return "-";
    return hit.isAway ? `@${hit.opp}` : hit.opp;
  };

  const ptsDetail = (player: Player) => {
    const live = livePtsOf(player);
    const progress = progressForPlayer(player, progressByNflTeam);
    const phase = progress?.phase ?? "pre";
    const showLive = phase !== "pre" || live > 0;
    const bye = player.bye != null && player.bye === activeWeek;
    const proj = bye ? null : projectFor(player.id);
    return {
      liveLabel: showLive ? live.toFixed(1) : "-",
      projLabel: proj != null ? `${proj.toFixed(1)} Proj` : "- Proj",
    };
  };

  const gameIsLive = (player: Player): boolean => {
    const phase = progressForPlayer(player, progressByNflTeam)?.phase ?? "pre";
    return (
      phase !== "pre" ||
      livePtsOf(player) !== 0 ||
      hasScorableProjectionStats(actualStatsFor(player.id))
    );
  };

  const fmtLivePts = (player: Player): string => {
    if (!gameIsLive(player)) return "-";
    const pts = livePtsOf(player);
    if (pts === 0) return "-";
    return pts.toFixed(1);
  };

  return (
    <div>
      <div className="mb-4 flex w-full items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="display-title text-3xl">
            My <span className="text-primary">Team</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeLeague?.name?.trim() || "Active league"} roster command center.
          </p>
        </div>
        {tab === "overview" ? null : <WeekSelector week={activeWeek} onChange={setSelectedWeek} />}
      </div>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-border pb-px">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "px-3 py-2 text-sm font-semibold transition-colors",
              tab === item.id
                ? "border-b-2 border-blue-600 text-blue-600"
                : "text-slate-500 hover:text-blue-600",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "overview" && myTeam ? (
        <TeamOverview rosterId={myTeam.slot} onOpenPlayer={openPlayer} />
      ) : (
      <section>
      {loading && !myTeam ? (
        <p className="text-sm text-muted-foreground">Loading your roster…</p>
      ) : !myTeam ? (
        <p className="text-sm text-muted-foreground">
          Sync a league to load your My Team dashboard.{" "}
          <Link to="/account/leagues" className="font-semibold text-primary hover:underline">
            Sync New League
          </Link>
        </p>
      ) : tab === "lineup" ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[1080px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                <th className={thClass}>Pos</th>
                <th className={thClass}>Player</th>
                <th className={thClass}>POS RANK</th>
                <th className={thClass}>Opponent</th>
                <th className={thClass}>Matchup</th>
                <th className={thRightClass}>Points</th>
                <th className={thClass}>News / Notes</th>
              </tr>
            </thead>
            <tbody>
              {allRows.map((row, index) => {
                const player = row.player;
                const rowTone =
                  index % 2 === 0 ? "bg-white" : "bg-slate-50/50";
                if (!player) {
                  return (
                    <tr
                      key={`empty-${row.slot}-${index}`}
                      className={cn("border-b border-slate-100", rowTone)}
                    >
                      <td className="px-3 py-3">
                        <PositionBadge pos={row.slot} />
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-400" colSpan={6}>
                        Empty slot
                      </td>
                    </tr>
                  );
                }
                const pts = ptsDetail(player);
                const news = newsById.get(player.id);
                const sos = weeklySosHitFor(player);
                return (
                  <tr
                    key={`${row.slot}-${player.id}-${index}`}
                    className={cn("border-b border-slate-100", rowTone)}
                  >
                    <td className="px-3 py-3 align-middle">
                      <PositionBadge pos={row.slot} />
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <button
                        type="button"
                        onClick={() => openPlayer(player.id)}
                        className="flex min-w-0 items-center gap-3 text-left transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        <PlayerAvatar
                          id={player.id}
                          pos={player.pos}
                          team={player.team}
                          name={player.name}
                          className="size-10"
                          logoClassName="size-3.5"
                        />
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate font-semibold text-slate-900">
                              {player.name}
                            </span>
                            <RowInjuryBadge
                              player={player}
                              onOpen={() => openPlayer(player.id)}
                            />
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] font-medium uppercase text-slate-400">
                            {playerByeMeta(player)}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-3 align-middle text-sm font-medium tabular-nums text-slate-500">
                      {posRankLabel(player, rankFor(player.id).pos)}
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold uppercase tabular-nums text-slate-800">
                          {opponentLabelFor(player)}
                        </span>
                        <span className="text-[11px] font-medium text-slate-400">
                          {scheduleLabelFor(player)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <SosStars stars={sos.stars} />
                    </td>
                    <td className="px-3 py-3 align-middle text-right">
                      <span className="block text-sm font-bold tabular-nums text-slate-900">
                        {pts.liveLabel}
                      </span>
                      <span className="block text-[11px] font-medium tabular-nums text-slate-400">
                        {pts.projLabel}
                      </span>
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <PlayerNewsCell
                        headline={news?.headline ?? null}
                        description={news?.description ?? null}
                        link={news?.link ?? null}
                        loading={Boolean(news?.loading)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : tab === "projections" ? (
        <div className="space-y-6">
          {/* OFFENSIVE */}
          <div>
            <span className={sectionBannerClass}>OFFENSIVE</span>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[1100px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80">
                    <th className={thClass}>POS</th>
                    <th className={thClass}>PLAYER</th>
                    <th className={thClass}>OPP</th>
                    <th className={thRightClass}>PROJ PTS</th>
                    <th className={thRightClass}>PASS YDS</th>
                    <th className={thRightClass}>PASS TD</th>
                    <th className={thRightClass}>INT</th>
                    <th className={thRightClass}>RUSH ATT</th>
                    <th className={thRightClass}>RUSH YDS</th>
                    <th className={thRightClass}>RUSH TD</th>
                    <th className={thRightClass}>REC</th>
                    <th className={thRightClass}>REC YDS</th>
                    <th className={thRightClass}>REC TD</th>
                  </tr>
                </thead>
                <tbody>
                  {offensiveProjRows.length === 0 ? (
                    <tr className="border-b border-slate-100 bg-white">
                      <td colSpan={13} className="px-3 py-4 text-sm text-slate-400">
                        No offensive players on roster.
                      </td>
                    </tr>
                  ) : (
                    offensiveProjRows.map((row, index) => {
                      const player = row.player!;
                      const stats = statsFor(player.id);
                      const bye = player.bye != null && player.bye === activeWeek;
                      const weekly = bye ? null : projectFor(player.id);
                      const rowTone = index % 2 === 1 ? "bg-slate-50/50" : "bg-white";
                      return (
                        <tr
                          key={`off-${player.id}-${index}`}
                          className={cn("border-b border-slate-100", rowTone)}
                        >
                          <td className="px-3 py-3 align-middle">
                            <PositionBadge pos={player.pos} />
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <ProjectionPlayerCell player={player} onOpen={openPlayer} />
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <div className="flex flex-col">
                              <span className="text-sm font-semibold uppercase tabular-nums text-slate-800">
                                {opponentLabelFor(player)}
                              </span>
                              <span className="mt-0.5 text-[10px] font-medium text-slate-400">
                                {scheduleLabelFor(player)}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-3 align-middle text-right font-semibold tabular-nums text-slate-900">
                            {weekly != null ? weekly.toFixed(1) : "-"}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtProjStat(stats, "pass_yd")}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtProjStat(stats, "pass_td", 1)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtProjStat(stats, "pass_int", 1)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtProjStat(stats, "rush_att", 1)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtProjStat(stats, "rush_yd")}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtProjStat(stats, "rush_td", 1)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtProjStat(stats, "rec", 1)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtProjStat(stats, "rec_yd")}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtProjStat(stats, "rec_td", 1)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* KICKERS */}
          <div>
            <span className={sectionBannerClass}>KICKERS</span>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80">
                    <th className={thClass}>POS</th>
                    <th className={thClass}>PLAYER</th>
                    <th className={thClass}>OPP</th>
                    <th className={thRightClass}>PROJ PTS</th>
                    <th className={thRightClass}>FGM</th>
                    <th className={thRightClass}>FGA</th>
                    <th className={thRightClass}>XPM</th>
                  </tr>
                </thead>
                <tbody>
                  {kickerProjRows.length === 0 ? (
                    <tr className="border-b border-slate-100 bg-white">
                      <td colSpan={7} className="px-3 py-4 text-sm text-slate-400">
                        No kickers on roster.
                      </td>
                    </tr>
                  ) : (
                    kickerProjRows.map((row, index) => {
                      const player = row.player!;
                      const stats = statsFor(player.id);
                      const bye = player.bye != null && player.bye === activeWeek;
                      const weekly = bye ? null : projectFor(player.id);
                      const rowTone = index % 2 === 1 ? "bg-slate-50/50" : "bg-white";
                      return (
                        <tr
                          key={`k-${player.id}-${index}`}
                          className={cn("border-b border-slate-100", rowTone)}
                        >
                          <td className="px-3 py-3 align-middle">
                            <PositionBadge pos={player.pos} />
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <ProjectionPlayerCell player={player} onOpen={openPlayer} />
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <div className="flex flex-col">
                              <span className="text-sm font-semibold uppercase tabular-nums text-slate-800">
                                {opponentLabelFor(player)}
                              </span>
                              <span className="mt-0.5 text-[10px] font-medium text-slate-400">
                                {scheduleLabelFor(player)}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-3 align-middle text-right font-semibold tabular-nums text-slate-900">
                            {weekly != null ? weekly.toFixed(1) : "-"}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtProjStat(stats, "fgm", 1)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtFga(stats)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtProjStat(stats, "xpm", 1)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* DEFENSIVE */}
          <div>
            <span className={sectionBannerClass}>DEFENSIVE</span>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80">
                    <th className={thClass}>POS</th>
                    <th className={thClass}>PLAYER</th>
                    <th className={thClass}>OPP</th>
                    <th className={thRightClass}>PROJ PTS</th>
                    <th className={thRightClass}>SACK</th>
                    <th className={thRightClass}>INT</th>
                    <th className={thRightClass}>FR</th>
                    <th className={thRightClass}>TD</th>
                    <th className={thRightClass}>PTS ALLOWED</th>
                    <th className={thRightClass}>YDS ALLOWED</th>
                  </tr>
                </thead>
                <tbody>
                  {defensiveProjRows.length === 0 ? (
                    <tr className="border-b border-slate-100 bg-white">
                      <td colSpan={10} className="px-3 py-4 text-sm text-slate-400">
                        No defensive units on roster.
                      </td>
                    </tr>
                  ) : (
                    defensiveProjRows.map((row, index) => {
                      const player = row.player!;
                      const stats = statsFor(player.id);
                      const bye = player.bye != null && player.bye === activeWeek;
                      const weekly = bye ? null : projectFor(player.id);
                      const rowTone = index % 2 === 1 ? "bg-slate-50/50" : "bg-white";
                      const defTd =
                        stats?.["def_td"] != null
                          ? fmtProjStat(stats, "def_td", 1)
                          : stats?.["td"] != null
                            ? fmtProjStat(stats, "td", 1)
                            : "-";
                      return (
                        <tr
                          key={`def-${player.id}-${index}`}
                          className={cn("border-b border-slate-100", rowTone)}
                        >
                          <td className="px-3 py-3 align-middle">
                            <PositionBadge pos={player.pos} />
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <ProjectionPlayerCell player={player} onOpen={openPlayer} />
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <div className="flex flex-col">
                              <span className="text-sm font-semibold uppercase tabular-nums text-slate-800">
                                {opponentLabelFor(player)}
                              </span>
                              <span className="mt-0.5 text-[10px] font-medium text-slate-400">
                                {scheduleLabelFor(player)}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-3 align-middle text-right font-semibold tabular-nums text-slate-900">
                            {weekly != null ? weekly.toFixed(1) : "-"}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtProjStat(stats, "sack", 1)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtProjStat(stats, "int", 1)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtProjStat(stats, "fum_rec", 1)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {defTd}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtProjStat(stats, "pts_allow")}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtProjStat(stats, "yds_allow")}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : tab === "statistics" ? (
        <div className="space-y-6">
          {/* OFFENSIVE */}
          <div>
            <span className={sectionBannerClass}>OFFENSIVE</span>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[1100px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80">
                    <th className={thClass}>POS</th>
                    <th className={thClass}>PLAYER</th>
                    <th className={thClass}>OPP</th>
                    <th className={thRightClass}>PTS</th>
                    <th className={thRightClass}>PASS YDS</th>
                    <th className={thRightClass}>PASS TD</th>
                    <th className={thRightClass}>INT</th>
                    <th className={thRightClass}>RUSH ATT</th>
                    <th className={thRightClass}>RUSH YDS</th>
                    <th className={thRightClass}>RUSH TD</th>
                    <th className={thRightClass}>REC</th>
                    <th className={thRightClass}>REC YDS</th>
                    <th className={thRightClass}>REC TD</th>
                  </tr>
                </thead>
                <tbody>
                  {offensiveStatRows.length === 0 ? (
                    <tr className="border-b border-slate-100 bg-white">
                      <td colSpan={13} className="px-3 py-4 text-sm text-slate-400">
                        No offensive players on roster.
                      </td>
                    </tr>
                  ) : (
                    offensiveStatRows.map((row, index) => {
                      const player = row.player!;
                      const stats = actualStatsFor(player.id);
                      const live = gameIsLive(player);
                      const rowTone = index % 2 === 1 ? "bg-slate-50/50" : "bg-white";
                      return (
                        <tr
                          key={`stat-off-${player.id}-${index}`}
                          className={cn("border-b border-slate-100", rowTone)}
                        >
                          <td className="px-3 py-3 align-middle">
                            <PositionBadge pos={player.pos} />
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <ProjectionPlayerCell player={player} onOpen={openPlayer} />
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <div className="flex flex-col">
                              <span className="text-sm font-semibold uppercase tabular-nums text-slate-800">
                                {opponentLabelFor(player)}
                              </span>
                              <span className="mt-0.5 text-[10px] font-medium text-slate-400">
                                {scheduleLabelFor(player)}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-3 align-middle text-right font-semibold tabular-nums text-slate-900">
                            {fmtLivePts(player)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtActualStat(stats, "pass_yd", 0, live)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtActualStat(stats, "pass_td", 0, live)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtActualStat(stats, "pass_int", 0, live)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtActualStat(stats, "rush_att", 0, live)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtActualStat(stats, "rush_yd", 0, live)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtActualStat(stats, "rush_td", 0, live)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtActualStat(stats, "rec", 0, live)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtActualStat(stats, "rec_yd", 0, live)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtActualStat(stats, "rec_td", 0, live)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* KICKERS */}
          <div>
            <span className={sectionBannerClass}>KICKERS</span>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80">
                    <th className={thClass}>POS</th>
                    <th className={thClass}>PLAYER</th>
                    <th className={thClass}>OPP</th>
                    <th className={thRightClass}>PTS</th>
                    <th className={thRightClass}>FGM</th>
                    <th className={thRightClass}>FGA</th>
                    <th className={thRightClass}>XPM</th>
                  </tr>
                </thead>
                <tbody>
                  {kickerStatRows.length === 0 ? (
                    <tr className="border-b border-slate-100 bg-white">
                      <td colSpan={7} className="px-3 py-4 text-sm text-slate-400">
                        No kickers on roster.
                      </td>
                    </tr>
                  ) : (
                    kickerStatRows.map((row, index) => {
                      const player = row.player!;
                      const stats = actualStatsFor(player.id);
                      const live = gameIsLive(player);
                      const rowTone = index % 2 === 1 ? "bg-slate-50/50" : "bg-white";
                      return (
                        <tr
                          key={`stat-k-${player.id}-${index}`}
                          className={cn("border-b border-slate-100", rowTone)}
                        >
                          <td className="px-3 py-3 align-middle">
                            <PositionBadge pos={player.pos} />
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <ProjectionPlayerCell player={player} onOpen={openPlayer} />
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <div className="flex flex-col">
                              <span className="text-sm font-semibold uppercase tabular-nums text-slate-800">
                                {opponentLabelFor(player)}
                              </span>
                              <span className="mt-0.5 text-[10px] font-medium text-slate-400">
                                {scheduleLabelFor(player)}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-3 align-middle text-right font-semibold tabular-nums text-slate-900">
                            {fmtLivePts(player)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtActualStat(stats, "fgm", 0, live)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtActualFga(stats, live)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtActualStat(stats, "xpm", 0, live)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* DEFENSIVE */}
          <div>
            <span className={sectionBannerClass}>DEFENSIVE</span>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80">
                    <th className={thClass}>POS</th>
                    <th className={thClass}>PLAYER</th>
                    <th className={thClass}>OPP</th>
                    <th className={thRightClass}>PTS</th>
                    <th className={thRightClass}>SACK</th>
                    <th className={thRightClass}>INT</th>
                    <th className={thRightClass}>FR</th>
                    <th className={thRightClass}>TD</th>
                    <th className={thRightClass}>PTS ALLOWED</th>
                    <th className={thRightClass}>YDS ALLOWED</th>
                  </tr>
                </thead>
                <tbody>
                  {defensiveStatRows.length === 0 ? (
                    <tr className="border-b border-slate-100 bg-white">
                      <td colSpan={10} className="px-3 py-4 text-sm text-slate-400">
                        No defensive units on roster.
                      </td>
                    </tr>
                  ) : (
                    defensiveStatRows.map((row, index) => {
                      const player = row.player!;
                      const stats = actualStatsFor(player.id);
                      const live = gameIsLive(player);
                      const rowTone = index % 2 === 1 ? "bg-slate-50/50" : "bg-white";
                      const defTd = !live
                        ? "-"
                        : stats?.["def_td"] != null && Number(stats["def_td"]) !== 0
                          ? fmtActualStat(stats, "def_td", 0, live)
                          : stats?.["td"] != null && Number(stats["td"]) !== 0
                            ? fmtActualStat(stats, "td", 0, live)
                            : "-";
                      return (
                        <tr
                          key={`stat-def-${player.id}-${index}`}
                          className={cn("border-b border-slate-100", rowTone)}
                        >
                          <td className="px-3 py-3 align-middle">
                            <PositionBadge pos={player.pos} />
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <ProjectionPlayerCell player={player} onOpen={openPlayer} />
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <div className="flex flex-col">
                              <span className="text-sm font-semibold uppercase tabular-nums text-slate-800">
                                {opponentLabelFor(player)}
                              </span>
                              <span className="mt-0.5 text-[10px] font-medium text-slate-400">
                                {scheduleLabelFor(player)}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-3 align-middle text-right font-semibold tabular-nums text-slate-900">
                            {fmtLivePts(player)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtActualStat(stats, "sack", 0, live)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtActualStat(stats, "int", 0, live)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtActualStat(stats, "fum_rec", 0, live)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {defTd}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtActualStat(stats, "pts_allow", 0, live)}
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                            {fmtActualStat(stats, "yds_allow", 0, live)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : tab === "news" ? (
        <MyTeamNewsPanel
          feed={myTeamNews}
          feedLoading={injuryReports.isLoading || rosterNewsQuery.isLoading}
          sidebar={injuryReports.data?.items ?? []}
          sidebarLoading={injuryReports.isLoading}
          players={players}
          onOpenPlayer={openPlayer}
        />
      ) : null}
      </section>
      )}

      <PlayerModalHost ref={modalRef} />
    </div>
  );
}
