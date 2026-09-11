import { PlayerAvatar, playerImage, teamLogo } from "@/components/draft/PlayerAvatar";
import { detailQuery } from "@/components/draft/PlayerDetail";
import { PositionBadge } from "@/components/draft/PositionBadge";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import { playbookCardClass } from "@/components/playbook/panels";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useActiveMatchups } from "@/hooks/useActiveMatchups";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useLeagueRosters, type ResolvedRosterTeam } from "@/hooks/useLeagueRosters";
import { useNflGameProgress } from "@/hooks/useNflGameProgress";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { useWeeklyActualStats } from "@/hooks/useWeeklyActualStats";
import type { Player, Pos } from "@/lib/draft";
import { getLeaguePlayerNews, getPlayerNews } from "@/lib/players.functions";
import { getTeamPrimaryColor } from "@/lib/nfl-teams";
import {
  currentSeason,
  fetchSchedule,
  type PlayersPayload,
  type ScheduleGame,
} from "@/lib/players-build";
import { starterRequirements } from "@/lib/power-rankings";
import {
  formatNflGameStatusLabel,
  formatNflKickoffLabel,
  type NflGameProgress,
} from "@/lib/rolling-live-projection";
import { getCached, readCache } from "@/lib/sleeper-cache";
import { sosStarsFromRank, weeklySosMatchupFor, type SosMatchup } from "@/lib/sos-presentation";
import { cn } from "@/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

export const Route = createFileRoute("/playbook/my-team")({
  ssr: false,
  head: () => ({
    meta: [{ title: "My Team — Playbook" }],
  }),
  component: PlaybookMyTeamPage,
});

type TeamTab = "overview" | "projections" | "statistics" | "news";

const TABS: { id: TeamTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "projections", label: "Projections" },
  { id: "statistics", label: "Statistics" },
  { id: "news", label: "News" },
];

const SKIP_STARTER_SLOTS = new Set(["BN", "BENCH", "IR", "IL", "TAXI", "RESERVE"]);
const FLEX_OK = new Set(["RB", "WR", "TE"]);
const weeklyFallback = (p: Player) => Math.max(0, (p.proj?.half ?? 0) / 17);

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
const PLAYERS_CACHE_KEY = "players-v1";
const DAY_MS = 24 * 60 * 60 * 1000;

type RosterRow = {
  slot: string;
  player: Player | null;
};

type ScheduleSosRow = SosMatchup & { isAway: boolean };

const thClass = "px-3 text-left text-xs font-black uppercase tracking-wider text-slate-900 py-3";
const thRightClass =
  "px-3 text-right text-xs font-black uppercase tracking-wider text-slate-900 py-3";

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

function posRankLabel(player: Player): string {
  const rank = Number(player.posRank);
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

async function loadDefenseRanks(): Promise<Map<string, number>> {
  const ranks = new Map<string, number>();
  try {
    const hit = await readCache<PlayersPayload>(PLAYERS_CACHE_KEY);
    const defenses = (hit?.data?.players ?? []).filter((p) => p.pos === "DEF");
    [...defenses]
      .sort((a, b) => b.proj.half - a.proj.half)
      .forEach((d, i) => {
        const team = (d.team || "").toUpperCase();
        if (team) ranks.set(team, i + 1);
      });
  } catch {
    /* ignore */
  }
  return ranks;
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

function buildScheduleSosByTeam(
  games: ScheduleGame[],
  ranks: Map<string, number>,
): Map<string, ScheduleSosRow[]> {
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
        rank: ranks.get(away) ?? null,
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
        rank: ranks.get(home) ?? null,
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

function SosStars({ stars }: { stars: number | null }) {
  const filled =
    stars != null && Number.isFinite(stars)
      ? Math.max(0, Math.min(5, Math.round(stars)))
      : 0;
  return (
    <span className="inline-flex shrink-0 items-center" aria-label={`${filled} of 5 matchup stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={`sos-star-${i}`}
          className={cn(
            i > 0 ? "ml-0.5" : undefined,
            i < filled ? "font-bold text-amber-500" : "text-slate-200",
          )}
        >
          {"\u2605"}
        </span>
      ))}
    </span>
  );
}

/**
 * Compact injury chip — same `["player", id]` / `player.injury` cache as PlayerDetail.
 * Healthy / null → render nothing.
 */
function RowInjuryBadge({
  playerId,
  playerName,
  onOpen,
}: {
  playerId: string;
  playerName: string;
  onOpen: () => void;
}) {
  const { data } = useQuery({
    ...detailQuery(playerId),
    enabled: Boolean(playerId),
  });

  const injury = data?.player?.injury;
  if (!injury || injury === "Healthy" || injury === "Active" || injury === "None") {
    return null;
  }

  let label: "Q" | "O" | "IR" | "NA" | null = null;
  if (injury === "Questionable") label = "Q";
  else if (injury === "Out" || injury === "Doubtful") label = "O";
  else if (injury === "IR") label = "IR";
  else if (injury === "NA") label = "NA";
  else return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      aria-label={`${playerName} injury status ${label}`}
      className={cn(
        "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[2px] px-1 text-[9px] font-bold text-white transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        label === "Q" ? "bg-amber-500/80" : "bg-rose-600/80",
      )}
    >
      {label}
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

function firstNewsSentence(text: string): string {
  const raw = (text ?? "").trim();
  if (!raw) return "No full report available yet.";
  const match = raw.match(/^[\s\S]+?[.!?](?=\s|$)/);
  if (match?.[0]) return match[0].trim();
  const words = raw.split(/\s+/);
  if (words.length <= 22) return raw;
  return `${words.slice(0, 22).join(" ").trim()}…`;
}

function splitNewsCopy(description: string): { body: string; impact: string } {
  const raw = (description ?? "").trim();
  if (!raw) {
    return {
      body: "No full report available yet.",
      impact: "Check practice reports and snap trends before locking your lineup.",
    };
  }
  const marker = /fantasy\s*impact\s*:/i;
  const hit = marker.exec(raw);
  if (hit && hit.index != null) {
    const before = raw.slice(0, hit.index).trim();
    const impact =
      raw.slice(hit.index + hit[0].length).trim() ||
      "Monitor role and injury designation ahead of kickoff.";
    return { body: firstNewsSentence(before || raw), impact: firstNewsSentence(impact) };
  }
  const sentences = raw.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length >= 2) {
    return {
      body: firstNewsSentence(sentences[0]!),
      impact: sentences.slice(1).join(" ").trim(),
    };
  }
  return {
    body: firstNewsSentence(raw),
    impact: "Factor this update into start/sit and bench priority decisions for the week.",
  };
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
          <RowInjuryBadge
            playerId={player.id}
            playerName={player.name}
            onOpen={() => onOpen(player.id)}
          />
        </span>
        <span className="mt-0.5 block truncate text-[11px] font-medium uppercase text-slate-400">
          {playerByeMeta(player)}
        </span>
      </span>
    </button>
  );
}

type FeaturedNewsCard = {
  player: Player;
  item: {
    id: string;
    /** Owning sleeper id — must equal `player.id` before render. */
    playerId: string;
    headline: string;
    description: string;
    link: string | null;
    published: string;
  };
  body: string;
  impact: string;
};

type LeagueSidebarRow = {
  id: string;
  playerName: string;
  sleeperId: string | null;
  team: string | null;
  pos: string | null;
  snippet: string;
  link: string | null;
  injuryLabel: "Q" | "O" | "IR" | "NA" | null;
};

function SidebarInjuryLetter({ label }: { label: "Q" | "O" | "IR" | "NA" }) {
  return (
    <span
      className={cn(
        "mr-1.5 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[2px] px-1 text-[9px] font-bold text-white",
        label === "Q" ? "bg-amber-500/80" : "bg-rose-600/80",
      )}
    >
      {label}
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

function premiumNewsHeadlineFallback(player: Player): string {
  return `${player.name} Weekly Roster Update`;
}

function premiumNewsBodyFallback(player: Player): string {
  const name = player.name;
  const team = (player.team || "").trim().toUpperCase() || "club";
  const pos = (player.pos || "").toUpperCase();
  switch (pos) {
    case "QB":
      return `${name} continues directing the ${team} offensive scheme during weekly team preparations.`;
    case "RB":
      return `${name} maintains focus on backfield workloads and team walkthroughs ahead of the upcoming matchup.`;
    case "WR":
    case "TE":
      return `${name} continues working through target-share alignments and team schemes with the ${team} passing offense.`;
    default:
      return `${name} continues preparations with the ${team} ahead of the upcoming weekly matchup.`;
  }
}

function premiumNewsImpactFallback(player: Player): string {
  const name = player.name;
  const pos = (player.pos || "").toUpperCase();
  switch (pos) {
    case "QB":
      return `Ensure ${name} is locked into starting configurations for optimal passing floor potential. Check final weather grids.`;
    case "RB":
    case "WR":
    case "TE":
      return "Monitor active team practice logs and official game-day depth chart declarations for situational volume adjustments.";
    default:
      return "Monitor active team practice logs and official game-day depth chart declarations for situational volume adjustments.";
  }
}

function resolveFeaturedBody(player: Player, body: string, item: FeaturedNewsCard["item"]): string {
  if (
    isGoofyOrMismatchedCopy(player, body) ||
    !newsCopyBelongsToPlayer(player, { headline: item.headline, description: body })
  ) {
    return premiumNewsBodyFallback(player);
  }
  return body;
}

function resolveFeaturedImpact(player: Player, impact: string): string {
  if (isGoofyOrMismatchedCopy(player, impact)) {
    return premiumNewsImpactFallback(player);
  }
  return impact;
}

const FANTASY_SIDEBAR_POS = new Set([
  "QB",
  "RB",
  "WR",
  "TE",
  "K",
  "DEF",
  "DST",
  "DL",
  "LB",
  "DB",
  "DE",
  "DT",
  "CB",
  "S",
  "IDP",
]);

const GENERIC_SIDEBAR_NOISE_RE =
  /\bnfl week\b|\buniforms?\b|\buniform combo\b|\bpower rankings?\b|\bwaiver wire\b|\bdfs\b|\bdraft kit\b|\bfantasy football 101\b|\bcoach\b|\bcoordinator\b|\bhead coach\b|\boffensive coordinator\b|\bdefensive coordinator\b|\bjesse minter\b/i;

function isUsableInjurySidebarRow(row: LeagueSidebarRow): boolean {
  const name = (row.playerName ?? "").trim();
  if (!name) return false;
  if (!row.sleeperId && sanitizePlayerName(name).length < 4) return false;
  const hay = `${name} ${row.snippet ?? ""}`;
  if (GENERIC_SIDEBAR_NOISE_RE.test(hay)) return false;
  if (/\bcoach\b/i.test(name)) return false;
  const pos = (row.pos ?? "").trim().toUpperCase();
  // Require a known fantasy / IDP position when the feed supplies one.
  if (pos && !FANTASY_SIDEBAR_POS.has(pos)) return false;
  // Unpositioned rows without a sleeper id are too risky (coaches, staff, recaps).
  if (!pos && !row.sleeperId) return false;
  return true;
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
  row: LeagueSidebarRow;
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
  const isDefensiveOrMissing =
    !headshotCandidate ||
    isIdpOrDefensivePos(pos) ||
    pos === "DEF" ||
    pos === "DL" ||
    pos === "LB" ||
    pos === "DB";
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

/**
 * Single News shell: one parent grid, two permanent column children.
 * Left feed + right injury sidebar never render as separate top-level siblings.
 */
function MyTeamNewsPanel({
  featuredCards,
  featuredLoading,
  sidebarRows,
  sidebarLoading,
  players,
  onOpenPlayer,
}: {
  featuredCards: FeaturedNewsCard[];
  featuredLoading: boolean;
  sidebarRows: LeagueSidebarRow[];
  sidebarLoading: boolean;
  players: Player[];
  onOpenPlayer: (id: string) => void;
}) {
  const sidebarTrack = useMemo(
    () => sidebarRows.filter(isUsableInjurySidebarRow).slice(0, 10),
    [sidebarRows],
  );
  const playersBySanitized = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of players) {
      const key = sanitizePlayerName(p.name);
      if (key && !map.has(key)) map.set(key, p);
    }
    return map;
  }, [players]);

  const resolveSidebarPlayer = (row: LeagueSidebarRow): Player | null => {
    if (row.sleeperId) {
      const byId = players.find((p) => p.id === row.sleeperId) ?? null;
      if (byId) return byId;
    }
    return playersBySanitized.get(sanitizePlayerName(row.playerName)) ?? null;
  };

  return (
    <div className="mx-auto mt-4 grid w-full max-w-7xl grid-cols-1 items-start gap-6 overflow-visible lg:grid-cols-[1fr_320px]">
      {/* LEFT COLUMN — featured roster news */}
      <section className="min-w-0 w-full" aria-label="Team news feed">
        {featuredLoading && featuredCards.length === 0 ? (
          <div className="mb-5 flex w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm">
            <div className="w-full px-6 py-4 text-sm text-slate-500">Loading latest roster news…</div>
          </div>
        ) : featuredCards.length === 0 ? (
          <div className="mb-5 flex w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm">
            <div className="w-full px-6 py-4 text-sm text-slate-500">
              No active ESPN notes for your rostered players right now.
            </div>
          </div>
        ) : (
          featuredCards.map(({ player, item, body, impact }) => {
            // Strict ownership — never render copy that belongs to another player id.
            if (item.playerId !== player.id) return null;
            if (!newsCopyBelongsToPlayer(player, item)) return null;
            const ago = newsTimeAgo(item.published);
            const logo = teamLogo(player.team);
            const displayBody = resolveFeaturedBody(player, body, item);
            const displayImpact = resolveFeaturedImpact(player, impact);
            const displayHeadline = newsCopyBelongsToPlayer(player, {
              headline: item.headline,
              description: "",
            })
              ? item.headline
              : premiumNewsHeadlineFallback(player);
            return (
              <article
                key={`featured-${player.id}-${item.id}`}
                className="mb-5 flex w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm"
              >
                {/* Full-bleed branded banner */}
                <div
                  className="relative z-10 flex w-full items-center justify-between overflow-hidden px-6 py-4"
                  style={{ backgroundColor: getTeamPrimaryColor(player.team) }}
                >
                  <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-r from-black/25 via-transparent to-transparent" />
                  {logo ? (
                    <img
                      src={logo}
                      alt=""
                      aria-hidden="true"
                      className="pointer-events-none absolute right-2 top-1/2 z-0 h-24 w-24 -translate-y-1/2 select-none object-contain opacity-[0.14] mix-blend-normal"
                    />
                  ) : null}
                  <div className="relative z-20 flex min-w-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => onOpenPlayer(player.id)}
                      className="flex-shrink-0"
                      aria-label={`Open ${player.name} details`}
                    >
                      <img
                        src={playerImage(player.id, player.pos, player.team)}
                        alt=""
                        loading="lazy"
                        className="relative z-20 h-14 w-14 flex-shrink-0 rounded-full border-2 border-white/40 object-cover shadow-sm"
                        onError={(e) => {
                          e.currentTarget.style.visibility = "hidden";
                        }}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenPlayer(player.id)}
                      className="truncate text-base font-black tracking-wide text-white hover:opacity-90"
                    >
                      {player.name}
                    </button>
                  </div>
                </div>

                {/* White content pad under banner */}
                <div className="flex w-full flex-col items-start p-6 pt-4">
                  {item.link && displayHeadline === item.headline ? (
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="relative z-10 mt-1.5 mb-1 block cursor-pointer text-xl font-black tracking-tight text-slate-900 transition-colors hover:text-blue-600"
                    >
                      {displayHeadline}
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenPlayer(player.id)}
                      className="relative z-10 mt-1.5 mb-1 block cursor-pointer text-left text-xl font-black tracking-tight text-slate-900 transition-colors hover:text-blue-600"
                    >
                      {displayHeadline}
                    </button>
                  )}

                  <span className="mb-4 block text-[11px] font-medium text-slate-400">
                    By ESPN{ago ? ` • ${ago}` : ""}
                  </span>

                  <p className="mb-4 block w-full border-l-2 border-slate-200/80 pl-3.5 text-left text-sm font-medium italic leading-relaxed text-slate-500">
                    {displayBody}
                  </p>

                  <div className="w-full rounded-xl border border-slate-100 bg-slate-50/70 p-4 text-left shadow-inner-sm">
                    <span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-900">
                      Fantasy Impact:
                    </span>
                    <p className="text-left text-xs font-medium leading-relaxed text-slate-600">
                      {displayImpact}
                    </p>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </section>

      {/* RIGHT COLUMN — PLAYER INJURY NEWS */}
      <aside
        className="w-full min-w-0 self-start text-left lg:sticky lg:top-4"
        aria-label="Player injury news"
      >
        <div className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm">
          <h2 className="mb-3 border-b border-slate-100 pb-2.5 text-xs font-black uppercase tracking-wider text-slate-900">
            PLAYER INJURY NEWS
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
                    if (!isUsableInjurySidebarRow(row)) return null;
                    const resolved = resolveSidebarPlayer(row);
                    const openId = resolved?.id ?? row.sleeperId;
                    const pos = (resolved?.pos ?? row.pos ?? "").toUpperCase();
                    if (pos && !FANTASY_SIDEBAR_POS.has(pos)) return null;
                    return (
                      <div
                        key={row.id}
                        className="flex w-full items-center space-x-3 border-b border-slate-50 py-2 last:border-0"
                      >
                        {openId ? (
                          <button
                            type="button"
                            onClick={() => onOpenPlayer(openId)}
                            className="flex-shrink-0"
                            aria-label={`Open ${row.playerName}`}
                          >
                            <SidebarPlayerThumb resolved={resolved} row={row} />
                          </button>
                        ) : (
                          <SidebarPlayerThumb resolved={resolved} row={row} />
                        )}
                        <p className="min-w-0 text-xs leading-tight text-slate-700">
                          {openId ? (
                            <button
                              type="button"
                              onClick={() => onOpenPlayer(openId)}
                              className="mr-1.5 text-xs font-black text-slate-900 hover:text-blue-600"
                            >
                              {resolved?.name ?? row.playerName}
                            </button>
                          ) : (
                            <span className="mr-1.5 text-xs font-black text-slate-900">
                              {row.playerName}
                            </span>
                          )}
                          {row.injuryLabel ? <SidebarInjuryLetter label={row.injuryLabel} /> : null}
                          {row.link ? (
                            <a
                              href={row.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-slate-700 transition-colors hover:text-blue-600"
                            >
                              {row.snippet}
                            </a>
                          ) : (
                            <span className="text-xs text-slate-700">{row.snippet}</span>
                          )}
                        </p>
                      </div>
                    );
                  })}
          </div>
          <Link
            to="/the-wire"
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
  const modalRef = useRef<PlayerModalHandle>(null);
  const [tab, setTab] = useState<TeamTab>(() => {
    if (typeof window === "undefined") return "overview";
    const saved = window.sessionStorage.getItem("playbook-my-team-tab");
    if (saved === "overview" || saved === "projections" || saved === "statistics" || saved === "news") {
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
      const [games, ranks] = await Promise.all([loadScheduleGames(), loadDefenseRanks()]);
      if (!alive) return;
      setScheduleSosByTeam(buildScheduleSosByTeam(games, ranks));
    })().catch(() => {
      /* silent */
    });
    return () => {
      alive = false;
    };
  }, []);

  const nflWeek = useQuery({
    queryKey: ["nfl-state-week"],
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
  const { projectFor, statsFor, loading: projectionsLoading } = useLeagueProjections(activeWeek);
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

  const livePtsOf = (player: Player) => Number(myPlayerPoints[player.id] ?? 0) || 0;

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
  }, [projectionSourceRows, myPlayerPoints]);

  const kickerStatRows = useMemo(
    () =>
      projectionSourceRows
        .filter((r) => r.player?.pos === "K")
        .slice()
        .sort((a, b) => livePtsOf(b.player!) - livePtsOf(a.player!)),
    [projectionSourceRows, myPlayerPoints],
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
    [projectionSourceRows, myPlayerPoints],
  );

  const newsQueries = useQueries({
    queries: rosteredPlayers.map((p) => ({
      queryKey: ["player-news", p.id] as const,
      queryFn: () => getPlayerNews({ data: { id: p.id } }),
      staleTime: 1000 * 60 * 10,
      enabled: Boolean(p.id) && (tab === "overview" || tab === "news"),
    })),
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
        items: {
          id: string;
          playerId: string;
          headline: string;
          description: string;
          link: string | null;
          published: string;
        }[];
        loading: boolean;
      }
    >();
    rosteredPlayers.forEach((p, i) => {
      const q = newsQueries[i];
      // Reject payload if the server player id does not match this roster row.
      const payloadPlayerId = q?.data?.player?.id;
      if (payloadPlayerId && payloadPlayerId !== p.id) {
        map.set(p.id, {
          headline: null,
          description: null,
          link: null,
          published: null,
          injuryNote: null,
          items: [],
          loading: Boolean(q?.isLoading),
        });
        return;
      }
      const items = (q?.data?.items ?? [])
        .map((item) => ({
          id: String(item.id),
          playerId: p.id,
          headline: item.headline?.trim() || "Player update",
          description: item.description?.trim() || "",
          link: item.link?.trim() || null,
          published: item.published?.trim() || "",
        }))
        .filter((item) => newsCopyBelongsToPlayer(p, item));
      const top = items[0];
      map.set(p.id, {
        headline: top?.headline ?? null,
        description: top?.description ?? null,
        link: top?.link ?? null,
        published: top?.published ?? null,
        injuryNote: q?.data?.injury?.note?.trim() || null,
        items,
        loading: Boolean(q?.isLoading),
      });
    });
    return map;
  }, [rosteredPlayers, newsQueries]);

  const featuredNewsCards = useMemo(() => {
    return rosteredPlayers
      .map((player) => {
        const pack = newsById.get(player.id);
        const loading = Boolean(pack?.loading);
        const top =
          pack?.items.find(
            (item) =>
              item.playerId === player.id &&
              newsCopyBelongsToPlayer(player, item) &&
              !isGoofyOrMismatchedCopy(player, item.headline),
          ) ?? null;

        // Always show a card for rostered players; use premium editorial fallbacks
        // when live ESPN copy is missing, goofy, or mismatched.
        if (!top || top.playerId !== player.id) {
          return {
            player,
            item: {
              id: `fallback-${player.id}`,
              playerId: player.id,
              headline: premiumNewsHeadlineFallback(player),
              description: premiumNewsBodyFallback(player),
              link: null,
              published: "",
            },
            body: premiumNewsBodyFallback(player),
            impact: premiumNewsImpactFallback(player),
            loading,
          } satisfies FeaturedNewsCard & { loading: boolean };
        }

        const copy = splitNewsCopy(top.description || top.headline);
        const rawImpact =
          pack?.injuryNote ||
          copy.impact ||
          premiumNewsImpactFallback(player);
        const body = resolveFeaturedBody(player, copy.body, top);
        const impact = resolveFeaturedImpact(player, firstNewsSentence(rawImpact));
        return {
          player,
          item: {
            ...top,
            headline: newsCopyBelongsToPlayer(player, {
              headline: top.headline,
              description: "",
            })
              ? top.headline
              : premiumNewsHeadlineFallback(player),
          },
          body,
          impact,
          loading,
        } satisfies FeaturedNewsCard & { loading: boolean };
      })
      .filter((row): row is NonNullable<typeof row> => row != null);
  }, [rosteredPlayers, newsById]);

  const leagueWideNews = useQuery({
    queryKey: ["league-wide-injury-news", 24],
    queryFn: () => getLeaguePlayerNews({ data: { limit: 24 } }),
    staleTime: 1000 * 60 * 10,
    // Prefetch so the News sidebar column never mounts empty on first paint / reload.
    enabled: true,
  });

  const morePlayerNews = useMemo(
    () => (leagueWideNews.data ?? []).filter(isUsableInjurySidebarRow),
    [leagueWideNews.data],
  );

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
    if (phaseFor(player) === "post") {
      const progressOpp = (progressForPlayer(player, progressByNflTeam)?.opponentAbbr ?? "")
        .trim()
        .toUpperCase();
      const team = (player.team || "").trim().toUpperCase();
      const schedHit = team
        ? scheduleSosByTeam.get(team)?.find((m) => Number(m.week) === Number(activeWeek))
        : undefined;
      return {
        stars: null,
        opp: progressOpp || (schedHit?.opp ?? null),
        isAway: Boolean(schedHit?.isAway),
      };
    }

    const brainHit = weeklySosMatchupFor(brain, player.id, activeWeek);
    const team = (player.team || "").trim().toUpperCase();
    const schedHit = team
      ? scheduleSosByTeam.get(team)?.find((m) => Number(m.week) === Number(activeWeek))
      : undefined;

    if (brainHit) {
      return {
        stars: sosStarsFromRank(brainHit.rank),
        opp: (brainHit.opp ?? "").trim().toUpperCase() || null,
        isAway: Boolean(schedHit?.isAway),
      };
    }

    if (schedHit) {
      return {
        stars: sosStarsFromRank(schedHit.rank),
        opp: (schedHit.opp ?? "").trim().toUpperCase() || null,
        isAway: Boolean(schedHit.isAway),
      };
    }

    const progressOpp = (progressForPlayer(player, progressByNflTeam)?.opponentAbbr ?? "")
      .trim()
      .toUpperCase();
    return { stars: null, opp: progressOpp || null, isAway: false };
  };

  const opponentLabelFor = (player: Player): string => {
    if (player.bye != null && player.bye === activeWeek) return "BYE";
    const hit = weeklySosHitFor(player);
    if (!hit.opp) return "-";
    return hit.isAway ? `@${hit.opp}` : hit.opp;
  };

  const ptsDetail = (player: Player) => {
    const live = Number(myPlayerPoints[player.id] ?? 0) || 0;
    const progress = progressForPlayer(player, progressByNflTeam);
    const phase = progress?.phase ?? "pre";
    const showLive = phase !== "pre" || live > 0;
    const proj = projectFor(player.id) ?? weeklyFallback(player);
    return {
      liveLabel: showLive ? live.toFixed(1) : "-",
      projLabel: `${proj.toFixed(1)} Proj`,
    };
  };

  const gameIsLive = (player: Player): boolean => {
    const live = Number(myPlayerPoints[player.id] ?? 0) || 0;
    const phase = progressForPlayer(player, progressByNflTeam)?.phase ?? "pre";
    return phase !== "pre" || live > 0;
  };

  const fmtLivePts = (player: Player): string => {
    if (!gameIsLive(player)) return "-";
    const pts = Number(myPlayerPoints[player.id] ?? 0) || 0;
    if (pts === 0) return "-";
    return pts.toFixed(1);
  };

  return (
    <section className={playbookCardClass}>
      <div className="mb-6 flex w-full items-start justify-between">
        <div className="min-w-0">
          <h1 className="display-title text-2xl font-bold uppercase tracking-wide text-slate-900">
            My Team
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeLeague?.name?.trim() || "Active league"} roster command center.
          </p>
        </div>
        <WeekSelector week={activeWeek} onChange={setSelectedWeek} />
      </div>

      <div className="mb-5 flex flex-wrap gap-1 border-b border-border pb-px">
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

      {loading && !myTeam ? (
        <p className="text-sm text-muted-foreground">Loading your roster…</p>
      ) : !myTeam ? (
        <p className="text-sm text-muted-foreground">
          Sync a league to load your My Team dashboard.{" "}
          <Link to="/account/leagues" className="font-semibold text-primary hover:underline">
            Sync New League
          </Link>
        </p>
      ) : tab === "overview" ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[1080px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-slate-50/60">
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
                              playerId={player.id}
                              playerName={player.name}
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
                      {posRankLabel(player)}
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
                  <tr className="border-b border-slate-100 bg-white">
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
                      const weekly = projectFor(player.id) ?? weeklyFallback(player);
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
                            {weekly.toFixed(1)}
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
                  <tr className="border-b border-slate-100 bg-white">
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
                      const weekly = projectFor(player.id) ?? weeklyFallback(player);
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
                            {weekly.toFixed(1)}
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
                  <tr className="border-b border-slate-100 bg-white">
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
                      const weekly = projectFor(player.id) ?? weeklyFallback(player);
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
                            {weekly.toFixed(1)}
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
                  <tr className="border-b border-slate-100 bg-white">
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
                  <tr className="border-b border-slate-100 bg-white">
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
                  <tr className="border-b border-slate-100 bg-white">
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
          featuredCards={featuredNewsCards}
          featuredLoading={newsQueries.some((q) => q.isLoading)}
          sidebarRows={morePlayerNews}
          sidebarLoading={leagueWideNews.isLoading}
          players={players}
          onOpenPlayer={openPlayer}
        />
      ) : null}

      <PlayerModalHost ref={modalRef} />
    </section>
  );
}
