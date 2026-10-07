import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Gauge, Target } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import { StreakIndicator } from "@/components/league/StreakIndicator";
import { MatchupPreviewCard, MatchupTeamAvatar } from "@/components/playbook/MatchupPreviewCard";
import {
  resolveAvatarUrl,
  ActivityFeed,
  resolvePowerRankDisplayBaseline,
  powerRankMovementDelta,
  playbookPanelTitleClass,
} from "@/components/playbook/panels";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useActiveMatchups } from "@/hooks/useActiveMatchups";
import { useActiveStandings } from "@/hooks/useActiveStandings";
import { useLeagueActivity } from "@/hooks/useLeagueActivity";
import { useLeagueAnalytics } from "@/hooks/useLeagueAnalytics";
import { useLeagueProjections, useNflState } from "@/hooks/useLeagueProjections";
import { useLeagueRosters, type ResolvedRosterTeam } from "@/hooks/useLeagueRosters";
import { useNflGameProgress } from "@/hooks/useNflGameProgress";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Player } from "@/lib/draft";
import { fetchLeagueSettingsForConnection } from "@/lib/league-settings-fetch";
import type { BrainMatrix } from "@/lib/playerBrainHydration";
import type { RosterNews, RosterNewsItem } from "@/lib/players.server";
import { fetchSnapRosterNews } from "@/lib/snap-cdn";
import {
  computeMatchupPreview,
  matchupSlotLabels as starterSlotLabels,
  matchupWeeklyFallback,
  resolveMatchupStarters,
} from "@/lib/matchup-preview";
import { buildTruePowerRankings, starterRequirements } from "@/lib/power-rankings";
import {
  computeDynamicWinProbability,
  type NflGameProgress,
} from "@/lib/rolling-live-projection";
import {
  buildStartSitAdvice,
  scaleValue,
  suggestMarketRadarTrade,
  suggestWaiverTransactions,
  type FitPlayer,
} from "@/lib/trade-engine";
import { fetchTrendingAddsClient } from "@/lib/sleeper-trending";
import { starterSlots, weeklyOptimalPoints } from "@/lib/standings-analytics";
import { cn } from "@/lib/utils";
import {
  awardsForTeam,
  buildPlayersByName,
  buildWeekReport,
  plainSentence,
  type AwardRow,
} from "@/lib/weekly-awards";

type CoachingWeekData = {
  week: number;
  status: "complete" | "open";
  isClosed: boolean;
  isCompleted: boolean;
  userPointsScored: number;
  /** Best possible lineup that week (shared with the standings page). */
  optimal: number;
  standingsPosition: string | null;
  standingsRecord: string | null;
};

function ordinalPlace(rank: number): string {
  const n = Math.max(1, Math.round(rank));
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
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

export const Route = createFileRoute("/playbook/")({
  ssr: false,
  component: PlaybookDashboardPage,
});

const panelClass = "rounded-xl border border-border bg-card p-4 sm:p-5";
/**
 * Season/17 invent for trade/insights only — matchup preview must not use this.
 * Keeps bye / injured players valued; unsigned NFL free agents are worth nothing.
 */
const weeklyFallback = (p: Player) => {
  const team = (p.team ?? "").trim().toUpperCase();
  if (!team || team === "FA") return 0;
  return Math.max(0, (p.proj?.half ?? 0) / 17);
};

function Panel({
  title,
  badge,
  action,
  children,
  className,
}: {
  title: string;
  badge?: ReactNode;
  action?: {
    to:
      | "/standings"
      | "/playbook/rankings"
      | "/playbook/matchup"
      | "/playbook/transactions"
      | "/playbook/my-team"
      | "/playbook/rosters";
    search?: { tab?: "actual" | "all-play" | "power" };
    label: string;
  };
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(panelClass, className)}>
      <div
        className={cn(
          "mb-3 items-center gap-3 border-b border-slate-200 pb-3",
          badge ? "grid grid-cols-[1fr_auto_1fr]" : "flex justify-between",
        )}
      >
        <h2 className={playbookPanelTitleClass}>{title}</h2>
        {badge}
        {action ? (
          <Link
            to={action.to}
            {...(action.search ? { search: action.search } : {})}
            className="justify-self-end text-xs font-semibold text-primary hover:underline"
          >
            {action.label}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function powerRankBadgeClass(rank: number): string {
  if (rank === 1) {
    return "inline-flex min-w-[2rem] items-center justify-center rounded-md border border-amber-300 bg-amber-200/90 px-2 py-0.5 text-center text-sm font-bold text-amber-950 shadow-sm";
  }
  if (rank === 2) {
    return "inline-flex min-w-[2rem] items-center justify-center rounded-md border border-slate-300 bg-slate-200 px-2 py-0.5 text-center text-sm font-bold text-slate-900 shadow-sm";
  }
  if (rank === 3) {
    return "inline-flex min-w-[2rem] items-center justify-center rounded-md border border-orange-300 bg-orange-200/80 px-2 py-0.5 text-center text-sm font-bold text-orange-950 shadow-sm";
  }
  return "inline-flex min-w-[2rem] items-center justify-center px-2 py-0.5 text-center text-sm font-semibold tabular-nums text-slate-500";
}

function powerRankPodiumRowClass(rank: number): string {
  if (rank === 1) return "border-l-4 border-l-amber-400 bg-amber-50";
  if (rank === 2) return "border-l-4 border-l-slate-400 bg-slate-100/90";
  if (rank === 3) return "border-l-4 border-l-orange-400 bg-orange-50";
  return "";
}

function powerRankTrend(delta: number | null): { label: string; className: string } {
  if (delta == null || delta === 0) {
    return { label: "—", className: "text-xs font-semibold tabular-nums text-slate-400" };
  }
  if (delta > 0) {
    return {
      label: `▲ ${delta}`,
      className: "text-xs font-semibold tabular-nums text-emerald-600",
    };
  }
  return {
    label: `▼ ${Math.abs(delta)}`,
    className: "text-xs font-semibold tabular-nums text-rose-600",
  };
}

/** FantasyPros-style WoW % chip (hidden when null — e.g. before week 2). */
function MetricDeltaPct({ deltaPct }: { deltaPct: number | null }) {
  if (deltaPct == null || !Number.isFinite(deltaPct)) return null;
  const flat = Math.abs(deltaPct) < 0.05;
  if (flat) {
    return (
      <span className="text-[11px] font-bold tabular-nums text-slate-400 leading-none">
        0.0%
      </span>
    );
  }
  const up = deltaPct > 0;
  return (
    <span
      className={cn(
        "text-[11px] font-bold tabular-nums leading-none",
        up ? "text-emerald-600" : "text-rose-500",
      )}
    >
      {up ? "▲" : "▼"} {up ? "+" : ""}
      {deltaPct.toFixed(1)}%
    </span>
  );
}

/** Dashboard standings chip: green when above .500, red below, grey when even. */
function recordToneClass(record: string): string {
  const parts = record.trim().split("-").map((part) => Number(part));
  const wins = parts[0];
  const losses = parts[1];
  if (wins == null || losses == null || !Number.isFinite(wins) || !Number.isFinite(losses)) {
    return "text-slate-400";
  }
  if (wins > losses) return "text-emerald-600";
  if (wins < losses) return "text-rose-500";
  return "text-slate-400";
}

type InsightActionTo =
  | "/playbook/rankings"
  | "/playbook/matchup"
  | "/playbook/transactions"
  | "/playbook/my-team"
  | "/playbook/rosters"
  | "/playbook/press-room"
  | "/waiver";

type InsightSlide = {
  id: string;
  tag: string;
  headline: string;
  body: string;
  /** Small supporting line under the body (report status, news timestamp). */
  meta?: string | undefined;
  player: Player | null;
  /** Fantasy team avatar for team-level slides (weekly awards). */
  team?: { name: string; logo: string | null } | undefined;
  action: { to: InsightActionTo; label: string };
};

const INJURY_TAGS = new Set([
  "Q",
  "Questionable",
  "O",
  "Out",
  "IR",
  "Injured Reserve",
  "NA",
  "Doubtful",
]);

function isActiveInjury(player: Player): boolean {
  const raw = player.injury || player.injury_status;
  return Boolean(raw && INJURY_TAGS.has(raw));
}

const DESIGNATION_RANK: Record<string, number> = {
  IR: 5,
  Out: 4,
  O: 4,
  Doubtful: 3,
  D: 3,
  Questionable: 2,
  Q: 2,
  NA: 1,
};

/**
 * Current designation, preferring the freshest source: NFL reserve list, then
 * this week's official report, then the server-side Sleeper status, then the
 * locally cached catalog.
 */
function designationFor(
  player: Player,
  news: RosterNewsItem | undefined,
  nflWeek: number | null,
): string | null {
  const sleeper = (news?.status ?? player.injury ?? player.injury_status ?? "").trim();
  if (news?.reserve || sleeper === "IR" || sleeper === "Injured Reserve") return "IR";
  if (news?.report?.status && nflWeek != null && news.report.week >= nflWeek) {
    return news.report.status;
  }
  return sleeper && INJURY_TAGS.has(sleeper) ? sleeper : null;
}

function practiceShort(practice: string | null | undefined): string | null {
  const text = (practice ?? "").toLowerCase();
  if (!text) return null;
  if (text.includes("did not")) return "Did not practice";
  if (text.includes("limited")) return "Limited in practice";
  if (text.includes("full")) return "Full practice";
  return practice ?? null;
}

function newsAge(published: string, nowMs: number): string | null {
  const at = Date.parse(published);
  if (!Number.isFinite(at)) return null;
  const mins = Math.max(0, Math.round((nowMs - at) / 60000));
  if (mins < 60) return `Updated ${Math.max(1, mins)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `Updated ${days}d ago`;
}

function clipText(text: string, max = 260): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).trim()}…`;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function isTonightKickoff(iso?: string | null, phase?: NflGameProgress["phase"]): boolean {
  if (phase === "in") return true;
  if (!iso) return false;
  const kick = new Date(iso);
  if (Number.isNaN(kick.getTime())) return false;
  const now = Date.now();
  const ms = kick.getTime() - now;
  // Same local day, or within the next 18 hours / last 3 hours.
  const sameDay = kick.toDateString() === new Date().toDateString();
  return sameDay || (ms > -3 * 60 * 60 * 1000 && ms < 18 * 60 * 60 * 1000);
}

function nightWindowTitle(iso?: string | null): string {
  if (!iso) return "Tonight's Games";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Tonight's Games";
  const day = d.getDay();
  const hour = d.getHours();
  if (day === 4) return "Thursday Night Football";
  if (day === 1) return "Monday Night Football";
  if (day === 0 && hour >= 19) return "Sunday Night Football";
  if (day === 0 && hour < 13) return "Sunday Early Window";
  if (day === 0) return "Sunday Afternoon Window";
  if (day === 6) return "Saturday Football";
  return "Tonight's Games";
}

function progressForTeam(
  progressByNflTeam: Map<string, NflGameProgress>,
  team: string | null | undefined,
): NflGameProgress | undefined {
  const abbr = (team ?? "").trim().toUpperCase();
  if (!abbr || abbr === "FA") return undefined;
  return progressByNflTeam.get(abbr);
}

const NFL_TEAM_ALIASES: Record<string, string[]> = {
  WAS: ["WAS", "WSH"],
  WSH: ["WAS", "WSH"],
  LAR: ["LAR", "LA"],
  LA: ["LAR", "LA"],
  JAC: ["JAC", "JAX"],
  JAX: ["JAC", "JAX"],
};

/** True once the team's game is live/final, or its kickoff time has passed. */
function nflGameLocked(
  progressByNflTeam: Map<string, NflGameProgress>,
  team: string | null | undefined,
  nowMs: number,
): boolean {
  const abbr = (team ?? "").trim().toUpperCase();
  if (!abbr || abbr === "FA") return false;
  for (const key of NFL_TEAM_ALIASES[abbr] ?? [abbr]) {
    const progress = progressByNflTeam.get(key);
    if (!progress) continue;
    if (progress.phase !== "pre") return true;
    const kickoff = progress.kickoffIso ? Date.parse(progress.kickoffIso) : NaN;
    if (Number.isFinite(kickoff) && kickoff <= nowMs) return true;
  }
  return false;
}

function buildTeamInsightSlides(opts: {
  myTeamPlayers: Player[];
  oppTeamPlayers: Player[];
  myStarters: Player[];
  oppStarters: Player[];
  progressByNflTeam: Map<string, NflGameProgress>;
  brain: BrainMatrix | null;
  nflWeek: number | null;
  rosterNews: RosterNews | null;
  /** Press Room awards this team earned in the last completed week. */
  awards: AwardRow[];
}): InsightSlide[] {
  const { myTeamPlayers, myStarters, oppStarters, progressByNflTeam, brain, nflWeek, rosterNews } =
    opts;
  const slides: InsightSlide[] = [];
  const currentDayIndex = new Date().getDay(); // 0 = Sunday

  // Slide 1 is suppressed on Sundays so the carousel only cycles news + notes.
  if (currentDayIndex !== 0) {
    // Starter-only gate: ignore bench and IR entirely for tonight alerts.
    const mineTonight = myStarters.filter((p) => {
      const progress = progressForTeam(progressByNflTeam, p.team);
      return progress && isTonightKickoff(progress.kickoffIso, progress.phase);
    });
    const oppTonight = oppStarters.filter((p) => {
      const progress = progressForTeam(progressByNflTeam, p.team);
      return progress && isTonightKickoff(progress.kickoffIso, progress.phase);
    });
    const tonightAll = [...mineTonight, ...oppTonight];
    const featuredTonight = mineTonight[0] ?? oppTonight[0] ?? null;
    const kickIso =
      progressForTeam(progressByNflTeam, featuredTonight?.team)?.kickoffIso ??
      tonightAll
        .map((p) => progressForTeam(progressByNflTeam, p.team)?.kickoffIso)
        .find(Boolean) ??
      null;
    const windowTitle = nightWindowTitle(kickIso);
    const tonightCount = new Set(tonightAll.map((p) => p.id)).size;

    // Hide the slide entirely when no starters are in tonight's window —
    // avoids the empty "No … Assets Locked In" card.
    if (tonightCount > 0 && featuredTonight) {
      slides.push({
        id: "watch-tonight",
        tag: "What to Watch Tonight",
        headline: `${tonightCount} Player${tonightCount === 1 ? "" : "s"} on ${windowTitle}`,
        body: mineTonight.some((p) => p.id === featuredTonight.id)
          ? `You have ${featuredTonight.name} kicking off tonight.`
          : `Your opponent has ${featuredTonight.name} playing tonight.`,
        player: featuredTonight,
        action: { to: "/playbook/matchup", label: "See Full Matchup" },
      });
    }
  }

  const nowMs = Date.now();
  const newsById = new Map((rosterNews?.players ?? []).map((n) => [n.id, n]));
  const starterIds = new Set(myStarters.map((p) => p.id));
  const newsAt = (p: Player) => {
    const at = Date.parse(newsById.get(p.id)?.news?.published ?? "");
    return Number.isFinite(at) ? at : 0;
  };
  const RECENT_INJURY_NEWS_MS = 7 * 24 * 60 * 60 * 1000;

  /*
   * Injury desk: anyone with a live designation, plus players whose latest
   * news is injury-related from the past week (catches new injuries before
   * the designation propagates). Starters always lead; bench players only
   * surface when no starter has an injury update. Within each group the
   * newest injury news leads, then severity.
   */
  const injuryCandidates = myTeamPlayers
    .map((p) => {
      const news = newsById.get(p.id);
      const label = designationFor(p, news, nflWeek);
      const injuryNewsAt =
        news?.news?.injury && nowMs - newsAt(p) <= RECENT_INJURY_NEWS_MS ? newsAt(p) : 0;
      return { player: p, news, label, injuryNewsAt };
    })
    .filter((c) => c.label != null || c.injuryNewsAt > 0 || (!rosterNews && isActiveInjury(c.player)))
    .sort(
      (a, b) =>
        Number(starterIds.has(b.player.id)) - Number(starterIds.has(a.player.id)) ||
        b.injuryNewsAt - a.injuryNewsAt ||
        (DESIGNATION_RANK[b.label ?? ""] ?? 0) - (DESIGNATION_RANK[a.label ?? ""] ?? 0),
    );
  const lead = injuryCandidates[0] ?? null;

  if (lead) {
    const p = lead.player;
    const bodyPart = (
      lead.news?.report?.injury ||
      lead.news?.bodyPart ||
      p.injury_body_part ||
      brain?.[p.id]?.injuryType ||
      ""
    ).trim();
    const report = lead.news?.report ?? null;
    const reportLine = report
      ? [
          `Week ${report.week} injury report: ${report.status ?? "No game designation"}`,
          practiceShort(report.practice),
        ]
          .filter(Boolean)
          .join(" · ")
      : null;
    const fallbackNotes = (p.injury_notes || brain?.[p.id]?.injuryNotes || "").trim();
    const body = lead.news?.news?.headline
      ? clipText(lead.news.news.headline)
      : fallbackNotes && fallbackNotes.length > 20
        ? clipText(fallbackNotes)
        : `${p.name} is listed ${lead.label ?? "on the injury report"}${bodyPart ? ` with a ${bodyPart.toLowerCase()} injury` : ""}. Monitor practice reports before lock.`;
    const age = lead.news?.news ? newsAge(lead.news.news.published, nowMs) : null;

    slides.push({
      id: "player-news",
      tag: "Player News",
      headline: `${p.name}${lead.label ? ` (${lead.label})` : ""}${bodyPart ? ` — ${bodyPart}` : ""}`,
      body,
      meta: [reportLine, age].filter(Boolean).join(" · ") || undefined,
      player: p,
      action: { to: "/playbook/my-team", label: "View All Team News" },
    });
  } else {
    slides.push({
      id: "player-news",
      tag: "Player News",
      headline: "Roster Clear on Injury Desk",
      body: "No active O, IR, Q, or NA designations on your roster right now.",
      player: null,
      action: { to: "/playbook/my-team", label: "View All Team News" },
    });
  }

  // Plan ahead: rostered players (not on IR) whose bye is next week.
  const nextWeek = nflWeek != null ? nflWeek + 1 : null;
  if (nextWeek != null && nextWeek <= 18) {
    const onBye = myTeamPlayers
      .filter((p) => Number(p.bye) === nextWeek)
      .filter((p) => designationFor(p, newsById.get(p.id), nflWeek) !== "IR")
      .sort(
        (a, b) =>
          Number(starterIds.has(b.id)) - Number(starterIds.has(a.id)) ||
          (brain?.[b.id]?.value ?? 0) - (brain?.[a.id]?.value ?? 0),
      );
    if (onBye.length > 0) {
      const names = onBye.map((p) => p.name);
      const startersOut = onBye.filter((p) => starterIds.has(p.id)).length;
      slides.push({
        id: "plan-ahead",
        tag: "Plan Ahead",
        headline:
          onBye.length === 1
            ? `${names[0]} is on bye next week`
            : `${onBye.length} of your players are on bye next week`,
        body:
          onBye.length === 1
            ? `${names[0]} is on bye in Week ${nextWeek}. Plan ahead on who you might need to pick up.`
            : `${joinNames(names.slice(0, 4))}${names.length > 4 ? ` and ${names.length - 4} more` : ""} are on bye in Week ${nextWeek}${startersOut > 0 ? `, including ${startersOut} current starter${startersOut === 1 ? "" : "s"}` : ""}. Plan ahead on who you might need to pick up.`,
        player: onBye[0] ?? null,
        action: { to: "/waiver", label: "View The Wire" },
      });
    }
  }

  for (const award of opts.awards) {
    slides.push({
      id: `award-${award.id}`,
      tag: "Press Room",
      headline: award.title,
      body: `${award.leadName} ${plainSentence(award.sentence)}`.trim(),
      player: award.player ?? null,
      team: award.player ? undefined : { name: award.teamName, logo: award.logo },
      action: { to: "/playbook/press-room", label: "View Press Room" },
    });
  }

  // Player notes: latest news on anyone other than the injury-desk lead, starters before bench.
  const noteCandidate = myTeamPlayers
    .filter((p) => p.id !== lead?.player.id && newsById.get(p.id)?.news)
    .sort(
      (a, b) =>
        Number(starterIds.has(b.id)) - Number(starterIds.has(a.id)) ||
        newsAt(b) - newsAt(a),
    )[0];

  if (noteCandidate) {
    const note = newsById.get(noteCandidate.id)!.news!;
    slides.push({
      id: "player-notes",
      tag: "Player Notes",
      headline: noteCandidate.name,
      body: clipText(note.analysis || note.headline),
      meta: newsAge(note.published, nowMs) ?? undefined,
      player: noteCandidate,
      action: { to: "/playbook/my-team", label: "View All Team Notes" },
    });
  } else {
    const notePlayer =
      [...myTeamPlayers]
        .filter((p) => p.id !== lead?.player.id)
        .sort((a, b) => (brain?.[b.id]?.value ?? 0) - (brain?.[a.id]?.value ?? 0))[0] ?? null;
    const noteEntry = notePlayer ? brain?.[notePlayer.id] : null;
    const noteTrend = noteEntry?.trend ?? 0;
    const noteValue = scaleValue(noteEntry?.value ?? 0);
    slides.push({
      id: "player-notes",
      tag: "Player Notes",
      headline: notePlayer ? notePlayer.name : "Team Notes Queue",
      body: notePlayer
        ? `${notePlayer.name} holds a Value/Trend of ${noteValue.toFixed(1)} with ${
            noteTrend > 0.2 ? "rising" : noteTrend < -0.2 ? "cooling" : "stable"
          } market movement across the latest projection window.`
        : "Sync a roster to unlock long-form player notes and projection context.",
      player: notePlayer,
      action: { to: "/playbook/my-team", label: "View All Team Notes" },
    });
  }

  return slides;
}

function InsightTeamAvatar({
  name,
  logo,
  platform,
}: {
  name: string;
  logo: string | null;
  platform: string | null;
}) {
  const src = resolveAvatarUrl(logo);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const shell =
    "flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-100 bg-slate-50";
  if (src && failedSrc !== src) {
    return (
      <span className={shell}>
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailedSrc(src)}
        />
      </span>
    );
  }
  if ((platform ?? "").trim().toLowerCase() === "espn") {
    return (
      <span className={shell}>
        <img src="/espn.png" alt="ESPN" className="h-10 w-10 object-contain" aria-hidden="true" />
      </span>
    );
  }
  const letters = name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "TM";
  return <span className={cn(shell, "text-sm font-bold text-slate-500")}>{letters}</span>;
}

function TeamInsightsCarousel({
  slides,
  resetKey,
  platform,
}: {
  slides: InsightSlide[];
  resetKey: string;
  platform: string | null;
}) {
  const [index, setIndex] = useState(0);
  const modalRef = useRef<PlayerModalHandle>(null);
  const count = slides.length;

  useEffect(() => {
    setIndex(0);
  }, [resetKey]);

  const safeIndex = count > 0 ? ((index % count) + count) % count : 0;
  const slide = count > 0 ? slides[safeIndex]! : null;

  const go = (next: number) => {
    if (!count) return;
    setIndex(((next % count) + count) % count);
  };

  return (
    <section className={panelClass}>
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <h2 className={playbookPanelTitleClass}>Team Insights</h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Previous insight"
            className="flex size-8 items-center justify-center text-slate-400 transition-colors hover:text-slate-700 disabled:opacity-35"
            disabled={count <= 1}
            onClick={() => go(safeIndex - 1)}
          >
            <ChevronLeft className="size-5 stroke-[2.5]" aria-hidden="true" />
          </button>
          <div className="flex items-center gap-2.5" aria-label="Insight slide indicators">
            {slides.map((item, i) => (
              <button
                key={item.id}
                type="button"
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === safeIndex ? "true" : undefined}
                className={cn(
                  "size-2.5 rounded-full transition-colors",
                  i === safeIndex
                    ? "bg-blue-600"
                    : "bg-slate-300/80 hover:bg-slate-400",
                )}
                onClick={() => go(i)}
              />
            ))}
          </div>
          <button
            type="button"
            aria-label="Next insight"
            className="flex size-8 items-center justify-center text-slate-500 transition-colors hover:text-slate-700 disabled:opacity-35"
            disabled={count <= 1}
            onClick={() => go(safeIndex + 1)}
          >
            <ChevronRight className="size-5 stroke-[2.5]" aria-hidden="true" />
          </button>
        </div>
      </div>

      {slide ? (
        // Every slide shares one grid cell so the card keeps the tallest slide's height.
        <div className="grid">
          {slides.map((item, i) => {
            const active = i === safeIndex;
            return (
              <div
                key={item.id}
                aria-hidden={active ? undefined : true}
                className={cn(
                  "flex w-full min-h-[140px] items-start space-x-6 p-4 [grid-area:1/1]",
                  !active && "invisible",
                )}
              >
                {item.player ? (
                  <button
                    type="button"
                    aria-label={`Open ${item.player.name} details`}
                    className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-full border border-slate-100 bg-slate-50 transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    onClick={() => modalRef.current?.open(item.player!.id)}
                  >
                    <PlayerAvatar
                      id={item.player.id}
                      pos={item.player.pos}
                      team={item.player.team}
                      name={item.player.name}
                      className="size-20"
                      logoClassName="size-5"
                    />
                  </button>
                ) : item.team ? (
                  <InsightTeamAvatar name={item.team.name} logo={item.team.logo} platform={platform} />
                ) : (
                  <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-full border border-slate-100 bg-slate-50 text-xs font-bold text-slate-400">
                    TLO
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    {item.tag}
                  </p>
                  <p className="mb-2 text-base font-black text-slate-900">{item.headline}</p>
                  <p className="text-xs leading-relaxed text-slate-600">{item.body}</p>
                  {item.meta ? (
                    <p className="mt-1.5 text-[11px] font-medium text-slate-400">{item.meta}</p>
                  ) : null}
                  <Link
                    to={item.action.to}
                    className="mt-3 inline-block text-xs font-semibold text-primary hover:underline"
                  >
                    {item.action.label}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          Sync a league roster to unlock Team Insights.
        </p>
      )}

      <PlayerModalHost ref={modalRef} />
    </section>
  );
}

type StandingRowLike = { wins: number; losses: number };

type LeagueMatchupSide = {
  rosterId: number;
  name: string;
  logo: string | null;
  live: number;
  proj: number;
  winPct: number;
};

type LeagueMatchupPair = {
  id: number;
  a: LeagueMatchupSide;
  b: LeagueMatchupSide;
  started: boolean;
  final: boolean;
};

function nflTeamPhase(
  progressByNflTeam: Map<string, NflGameProgress>,
  team: string | null | undefined,
): NflGameProgress["phase"] | null {
  const nfl = (team || "").trim().toUpperCase();
  if (!nfl) return null;
  const aliases =
    nfl === "WAS" || nfl === "WSH"
      ? ["WAS", "WSH"]
      : nfl === "LAR" || nfl === "LA"
        ? ["LAR", "LA"]
        : nfl === "JAC" || nfl === "JAX"
          ? ["JAC", "JAX"]
          : [nfl];
  for (const key of aliases) {
    const phase = progressByNflTeam.get(key)?.phase;
    if (phase) return phase;
  }
  return null;
}

function LeagueMatchupRow({
  pair,
  platform,
  cacheKey,
  recordFor,
}: {
  pair: LeagueMatchupPair;
  platform?: string | null;
  cacheKey: string;
  recordFor: (rosterId: number, name: string) => string | null;
}) {
  const { a, b, started, final } = pair;
  const aWon = final && a.live > b.live + 0.005;
  const bWon = final && b.live > a.live + 0.005;
  const tied = final && !aWon && !bWon;
  const aLeads = final ? aWon : a.winPct >= b.winPct;

  const projTone = (live: number, proj: number) => {
    if (!started || Math.abs(live - proj) < 0.005) return "text-slate-400";
    return live > proj ? "text-emerald-600" : "text-rose-600";
  };
  const scoreTone = (won: boolean) =>
    final && !won && !tied ? "text-slate-400" : "text-slate-900";
  const barWidth = (side: LeagueMatchupSide, won: boolean) =>
    final ? (won ? 100 : tied ? 50 : 0) : side.winPct;
  const pctLabel = (side: LeagueMatchupSide, won: boolean) =>
    final ? (tied ? "TIE" : won ? "WON" : "LOST") : `${side.winPct}%`;
  const pctTone = (leads: boolean) =>
    final && tied ? "text-slate-500" : leads ? "text-emerald-600" : "text-rose-600";

  const team = (side: LeagueMatchupSide, mirrored: boolean) => {
    const record = recordFor(side.rosterId, side.name);
    return (
      <Link
        to="/playbook/rosters"
        search={{ scout: String(side.rosterId) }}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 transition-opacity hover:opacity-85",
          mirrored && "flex-row-reverse text-right",
        )}
      >
        <MatchupTeamAvatar
          name={side.name}
          logo={side.logo}
          platform={platform ?? null}
          cacheKey={`${cacheKey}-${side.rosterId}`}
          size="sm"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-tight text-slate-900">
            {side.name}
          </span>
          {record ? (
            <span className="mt-0.5 block text-[11px] font-medium tabular-nums text-slate-400">
              {record}
            </span>
          ) : null}
        </span>
      </Link>
    );
  };

  const score = (side: LeagueMatchupSide, won: boolean, mirrored: boolean) => (
    <div className={cn("w-16 shrink-0", mirrored ? "text-left" : "text-right")}>
      <p className={cn("text-lg font-bold tabular-nums leading-tight", scoreTone(won))}>
        {side.live.toFixed(2)}
      </p>
      <p className={cn("text-[11px] font-medium tabular-nums", projTone(side.live, side.proj))}>
        {side.proj.toFixed(2)}
      </p>
    </div>
  );

  return (
    <li className="py-3">
      <div className="flex items-center gap-2 sm:gap-3">
        {team(a, false)}
        {score(a, aWon, false)}
        <span className="w-6 shrink-0 text-center text-[10px] font-extrabold uppercase text-slate-300">
          vs
        </span>
        {score(b, bWon, true)}
        {team(b, true)}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide">
        <span className={cn("w-10 shrink-0", pctTone(aLeads))}>{pctLabel(a, aWon)}</span>
        <div className="flex h-1 min-w-0 flex-1 items-center gap-1">
          <div className="flex h-full min-w-0 flex-1 justify-end overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500",
                final ? (aWon ? "bg-emerald-500" : "bg-transparent") : aLeads ? "bg-emerald-500" : "bg-rose-500",
              )}
              style={{ width: `${barWidth(a, aWon)}%` }}
            />
          </div>
          <div className="flex h-full min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500",
                final ? (bWon ? "bg-emerald-500" : "bg-transparent") : aLeads ? "bg-rose-500" : "bg-emerald-500",
              )}
              style={{ width: `${barWidth(b, bWon)}%` }}
            />
          </div>
        </div>
        <span className={cn("w-10 shrink-0 text-right", pctTone(!aLeads))}>{pctLabel(b, bWon)}</span>
      </div>
    </li>
  );
}

function PlaybookDashboardPage() {
  const { activeLeague } = useActiveLeague();
  const { data: playersPayload, loading: playersLoading } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const { teams, myTeam, rosterPositions, loading: rostersLoading } = useLeagueRosters(players);
  const { standings, loading: standingsLoading } = useActiveStandings();
  const { projectFor, loading: projectionsLoading } = useLeagueProjections();
  const brain = usePlayerBrain();
  const { events, loading: activityLoading } = useLeagueActivity();
  const modalRef = useRef<PlayerModalHandle>(null);
  const openPlayer = (id: string) => modalRef.current?.open(id);

  const nflWeek = useNflState();
  const currentWeek = nflWeek.data?.week ?? null;
  const { matchups, loading: matchupsLoading } = useActiveMatchups(currentWeek);
  const { progressByNflTeam } = useNflGameProgress(currentWeek);
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  /** Shared with My Team / Standings — one history fetch, same Max PF / efficiency math. */
  const leagueAnalytics = useLeagueAnalytics({ history: true, forecast: false });
  const completedThrough = leagueAnalytics.completedThrough;
  const completedWeekNumbers = leagueAnalytics.completedWeekNumbers;
  const historyStamp = leagueAnalytics.historyStamp;
  const optimalSlots = useMemo(() => starterSlots(rosterPositions), [rosterPositions]);

  const weeklyMatchups = useMemo((): CoachingWeekData[] => {
    const mySlot = myTeam?.slot ?? teams.find((t) => t.isMine)?.slot ?? null;
    if (mySlot == null) return [];

    type Tally = { wins: number; losses: number; ties: number; pointsFor: number };
    const seasonTallies = new Map<number, Tally>();
    const ensure = (rosterId: number): Tally => {
      const hit = seasonTallies.get(rosterId);
      if (hit) return hit;
      const fresh = { wins: 0, losses: 0, ties: 0, pointsFor: 0 };
      seasonTallies.set(rosterId, fresh);
      return fresh;
    };

    const out: CoachingWeekData[] = [];

    for (let index = 0; index < completedWeekNumbers.length; index += 1) {
      const week = completedWeekNumbers[index] ?? index + 1;
      // Use standings/display-aware ceiling — not only `week < nfl.week`.
      const isCompleted = week <= completedThrough;
      const entries = leagueAnalytics.historyQueries[index]?.data?.entries ?? [];
      const mine =
        entries.find((row) => Number(row.rosterId) === Number(mySlot)) ?? null;
      const optimal = mine
        ? weeklyOptimalPoints(mine, optimalSlots, (id) =>
            (playersById.get(id) ?? myTeam?.players.find((p) => p.id === id))?.pos ?? null,
          )
        : 0;

      let standingsPosition: string | null = null;
      let standingsRecord: string | null = null;

      if (isCompleted && entries.length) {
        for (const entry of entries) {
          ensure(Number(entry.rosterId)).pointsFor += Number(entry.points) || 0;
        }

        const byMatchup = new Map<number, typeof entries>();
        for (const entry of entries) {
          if (entry.matchupId == null) continue;
          const bucket = byMatchup.get(Number(entry.matchupId)) ?? [];
          bucket.push(entry);
          byMatchup.set(Number(entry.matchupId), bucket);
        }

        for (const pair of byMatchup.values()) {
          if (pair.length !== 2) continue;
          const [a, b] = pair;
          if (!a || !b) continue;
          const aPts = Number(a.points) || 0;
          const bPts = Number(b.points) || 0;
          const aT = ensure(Number(a.rosterId));
          const bT = ensure(Number(b.rosterId));
          if (aPts > bPts) {
            aT.wins += 1;
            bT.losses += 1;
          } else if (bPts > aPts) {
            bT.wins += 1;
            aT.losses += 1;
          } else {
            aT.ties += 1;
            bT.ties += 1;
          }
        }

        const ranked = [...seasonTallies.entries()]
          .map(([rosterId, t]) => ({ rosterId, ...t }))
          .sort(
            (a, b) =>
              b.wins - a.wins ||
              a.losses - b.losses ||
              b.pointsFor - a.pointsFor,
          );
        const myRank = ranked.findIndex((row) => Number(row.rosterId) === Number(mySlot));
        const myTally = seasonTallies.get(Number(mySlot));
        if (myRank >= 0) standingsPosition = ordinalPlace(myRank + 1);
        if (myTally) {
          standingsRecord =
            myTally.ties > 0
              ? `${myTally.wins}-${myTally.losses}-${myTally.ties}`
              : `${myTally.wins}-${myTally.losses}`;
        }
      }

      out.push({
        week,
        status: isCompleted ? "complete" : "open",
        isClosed: isCompleted,
        isCompleted,
        userPointsScored: Number(mine?.points ?? 0) || 0,
        optimal,
        standingsPosition,
        standingsRecord,
      });
    }

    return out;
    // historyStamp tracks fetch completion; query array identity is unstable each render.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- historyStamp
  }, [
    historyStamp,
    completedWeekNumbers,
    completedThrough,
    myTeam,
    teams,
    playersById,
    currentWeek,
    optimalSlots,
    leagueAnalytics.historyQueries,
  ]);

  const synchronizedWeeklyMetrics = useMemo(() => {
    const empty = {
      position: "—",
      record: "—",
      avgPoints: "—",
      efficiency: "—",
      avgPointsDeltaPct: null as number | null,
      efficiencyDeltaPct: null as number | null,
    };

    // Host standings are the source of truth for record / PF (already include
    // week 4 when the standings page does). Matchup-history boards can lag TiDB.
    const mySlot = myTeam?.slot ?? teams.find((t) => t.isMine)?.slot ?? null;
    const standingRows = standings?.rows ?? [];
    const myStanding =
      mySlot != null
        ? standingRows.find((r) => Number(r.rosterId) === Number(mySlot)) ?? null
        : null;
    const hostGames =
      myStanding != null
        ? (Number(myStanding.wins) || 0) +
          (Number(myStanding.losses) || 0) +
          (Number(myStanding.ties) || 0)
        : 0;
    const hostPf = myStanding != null ? Number(myStanding.pointsFor) || 0 : 0;
    const hostAvg = hostGames > 0 && hostPf > 0 ? hostPf / hostGames : null;
    const hostRank =
      myStanding != null
        ? standingRows.findIndex((r) => Number(r.rosterId) === Number(myStanding.rosterId))
        : -1;
    const hostPosition = hostRank >= 0 ? ordinalPlace(hostRank + 1) : null;
    const hostRecord =
      myStanding != null
        ? myStanding.ties > 0
          ? `${myStanding.wins}-${myStanding.losses}-${myStanding.ties}`
          : `${myStanding.wins}-${myStanding.losses}`
        : null;

    let totalUserScored = 0;
    let completedWeeksCount = 0;
    let weeksWithScores = 0;
    let finalPosition = hostPosition ?? empty.position;
    let finalRecord = hostRecord ?? empty.record;
    /** Per completed week: scored points + optimal ceiling (for WoW deltas). */
    const completedWeekStats: { scored: number; optimal: number }[] = [];

    for (const weekData of weeklyMatchups ?? []) {
      // CRITICAL GUARD RAIL: Ignore live, open, or in-progress weeks entirely.
      if (weekData.status !== "complete" && !weekData.isClosed && !weekData.isCompleted) {
        continue;
      }

      // Skip hollow weeks (CDN miss / no board) so we don't average zeros.
      const hasScore =
        (weekData.userPointsScored || 0) > 0 ||
        weekData.optimal > 0 ||
        Boolean(weekData.standingsRecord);
      if (!hasScore) continue;

      completedWeeksCount += 1;
      const scored = weekData.userPointsScored || 0;
      totalUserScored += scored;
      if (scored > 0 || weekData.optimal > 0) weeksWithScores += 1;

      // Prefer host standings for the card; history tallies only fill gaps.
      if (!hostPosition && weekData.standingsPosition) finalPosition = weekData.standingsPosition;
      if (!hostRecord && weekData.standingsRecord) finalRecord = weekData.standingsRecord;

      completedWeekStats.push({
        scored,
        optimal: weekData.optimal > 0 ? weekData.optimal : 0,
      });
    }

    // Avg points: host PF ÷ games when available (matches standings page).
    // Fall back to history average only when standings have not loaded yet.
    const historyAvg =
      completedWeeksCount > 0 && weeksWithScores > 0
        ? totalUserScored / completedWeeksCount
        : null;
    const calculatedAvgPoints = hostAvg ?? historyAvg;

    // Same Max PF / efficiency as My Team + Standings Actual (shared analytics).
    const myAnalytics =
      mySlot != null ? leagueAnalytics.analytics?.get(Number(mySlot)) ?? null : null;
    const seasonEff = (weeks: { scored: number; optimal: number }[]): number | null => {
      const optimal = weeks.reduce((sum, w) => sum + w.optimal, 0);
      if (optimal <= 0) return null;
      const scored = weeks.reduce((sum, w) => sum + w.scored, 0);
      return Math.min(100, (scored / optimal) * 100);
    };
    const effWeeks = completedWeekStats.filter((w) => w.optimal > 0);
    const currentEff =
      myAnalytics?.efficiency != null && Number.isFinite(myAnalytics.efficiency)
        ? Math.min(100, myAnalytics.efficiency)
        : seasonEff(effWeeks);
    const priorEff = effWeeks.length >= 2 ? seasonEff(effWeeks.slice(0, -1)) : null;

    if (calculatedAvgPoints == null && currentEff == null) {
      if (leagueAnalytics.analyticsLoading || leagueAnalytics.historyLoading) {
        return {
          ...empty,
          efficiency: "…",
          avgPoints: standingsLoading ? "…" : empty.avgPoints,
        };
      }
      return empty;
    }

    // WoW % — prefer host avg vs history-through-(n-1) when host has the extra week.
    let avgPointsDeltaPct: number | null = null;
    const efficiencyDeltaPct: number | null =
      currentEff != null && priorEff != null ? currentEff - priorEff : null;
    const deltaWeeks = Math.max(completedWeeksCount, hostGames);
    if (calculatedAvgPoints != null && deltaWeeks >= 2 && calculatedAvgPoints > 0.05) {
      if (hostAvg != null && completedWeekStats.length >= hostGames - 1 && hostGames >= 2) {
        const prior = completedWeekStats.slice(0, hostGames - 1);
        if (prior.length) {
          const priorAvg = prior.reduce((sum, w) => sum + w.scored, 0) / prior.length;
          avgPointsDeltaPct = ((calculatedAvgPoints - priorAvg) / calculatedAvgPoints) * 100;
        }
      } else if (completedWeekStats.length >= 2) {
        const prior = completedWeekStats.slice(0, -1);
        const priorAvg = prior.reduce((sum, w) => sum + w.scored, 0) / prior.length;
        avgPointsDeltaPct = ((calculatedAvgPoints - priorAvg) / calculatedAvgPoints) * 100;
      } else if (
        hostAvg != null &&
        hostGames >= 2 &&
        completedWeekStats.length === 1 &&
        hostPf > completedWeekStats[0]!.scored
      ) {
        // Partial history: derive prior avg from host PF minus the latest board week.
        const priorGames = hostGames - 1;
        const priorPf = hostPf - completedWeekStats[0]!.scored;
        if (priorGames > 0 && priorPf > 0) {
          const priorAvg = priorPf / priorGames;
          avgPointsDeltaPct = ((calculatedAvgPoints - priorAvg) / calculatedAvgPoints) * 100;
        }
      }
    }

    return {
      position: finalPosition,
      record: finalRecord,
      avgPoints:
        calculatedAvgPoints != null
          ? calculatedAvgPoints.toFixed(1)
          : leagueAnalytics.analyticsLoading || standingsLoading
            ? "…"
            : "—",
      efficiency:
        currentEff != null
          ? `${currentEff.toFixed(1)}%`
          : leagueAnalytics.analyticsLoading || leagueAnalytics.historyLoading
            ? "…"
            : "—",
      avgPointsDeltaPct,
      efficiencyDeltaPct,
    };
  }, [
    weeklyMatchups,
    standings,
    standingsLoading,
    myTeam,
    teams,
    leagueAnalytics.analytics,
    leagueAnalytics.analyticsLoading,
    leagueAnalytics.historyLoading,
  ]);

  const sleeperTrending = useQuery({
    queryKey: ["sleeper-trending-add", "v1", 24, 50],
    staleTime: 15 * 60 * 1000,
    retry: false,
    refetchIntervalInBackground: false,
    queryFn: () => fetchTrendingAddsClient(24, 50),
  });

  // Brain / TiDB warehouse values — no live FantasyCalc from the browser.
  const fantasyCalcMarket = useQuery({
    queryKey: ["fantasycalc-brain-values-v1", Boolean(brain)],
    staleTime: 30 * 60 * 1000,
    retry: false,
    enabled: Boolean(brain),
    queryFn: async () => {
      const out: Record<string, { value: number; trend: number }> = {};
      for (const [id, entry] of Object.entries(brain ?? {})) {
        if (!entry) continue;
        out[id] = { value: Number(entry.value) || 0, trend: Number(entry.trend) || 0 };
      }
      return out;
    },
  });

  const trendingAddById = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of sleeperTrending.data ?? []) {
      map.set(row.player_id, row.count);
    }
    return map;
  }, [sleeperTrending.data]);

  const loading =
    playersLoading ||
    rostersLoading ||
    standingsLoading ||
    projectionsLoading ||
    matchupsLoading ||
    nflWeek.isLoading;

  const powerRows = useMemo(() => {
    if (!teams.length) return [];
    const standingBySlot = new Map((standings?.rows ?? []).map((r) => [r.rosterId, r]));
    const inputs = teams.map((team) => {
      const standing = standingBySlot.get(team.slot);
      return {
        slot: team.slot,
        team: team.team,
        owner: team.owner,
        players: team.players,
        wins: standing?.wins ?? 0,
        losses: standing?.losses ?? 0,
        ties: standing?.ties ?? 0,
        pointsFor: standing?.pointsFor ?? 0,
      };
    });
    return buildTruePowerRankings(inputs, { brain, projectFor, rosterPositions });
  }, [teams, standings, brain, projectFor, rosterPositions]);

  const weeklyPair = useMemo(() => {
    const empty = {
      oppRosterId: null as number | null,
      oppName: null as string | null,
      oppLogo: null as string | null,
      myPoints: 0,
      oppPoints: 0,
      myStarterIds: [] as string[],
      myStarterNames: [] as string[],
      myPlayerPoints: {} as Record<string, number>,
      oppStarterIds: [] as string[],
      oppStarterNames: [] as string[],
      oppPlayerPoints: {} as Record<string, number>,
      myBaseline: 0,
      oppBaseline: 0,
    };
    const entries = matchups?.entries ?? [];
    if (!entries.length) return empty;

    const norm = (value: string | null | undefined) =>
      (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

    const myRosterId =
      myTeam?.slot ??
      teams.find((t) => t.isMine)?.slot ??
      null;

    const mine =
      (myRosterId != null
        ? entries.find((row) => Number(row.rosterId) === Number(myRosterId))
        : null) ??
      entries.find(
        (row) =>
          Boolean(activeLeague?.teamName) &&
          norm(row.teamName) === norm(activeLeague?.teamName),
      ) ??
      entries.find((row) => Boolean(myTeam?.team) && norm(row.teamName) === norm(myTeam?.team)) ??
      null;

    if (!mine) return empty;

    const matchupToken = mine.matchupId;
    const rival =
      matchupToken != null
        ? entries.find(
            (row) =>
              row.matchupId != null &&
              Number(row.matchupId) === Number(matchupToken) &&
              Number(row.rosterId) !== Number(mine.rosterId),
          ) ?? null
        : null;

    const rivalFromRosters =
      rival != null ? teams.find((t) => Number(t.slot) === Number(rival.rosterId)) ?? null : null;

    return {
      oppRosterId: rival?.rosterId ?? null,
      oppName: rivalFromRosters?.team || rival?.teamName || null,
      oppLogo: rivalFromRosters?.logo || rival?.logo || null,
      myPoints: mine.points,
      oppPoints: rival?.points ?? 0,
      myStarterIds: mine.starters ?? [],
      myStarterNames: mine.starterNames ?? [],
      myPlayerPoints: mine.playerPoints ?? {},
      oppStarterIds: rival?.starters ?? [],
      oppStarterNames: rival?.starterNames ?? [],
      oppPlayerPoints: rival?.playerPoints ?? {},
      myBaseline: mine.projectedPoints,
      oppBaseline: rival?.projectedPoints ?? 0,
    };
  }, [matchups, myTeam, teams, activeLeague?.teamName]);

  const oppTeam = useMemo(() => {
    if (weeklyPair.oppRosterId != null) {
      return teams.find((t) => Number(t.slot) === Number(weeklyPair.oppRosterId)) ?? null;
    }
    return null;
  }, [teams, weeklyPair.oppRosterId]);

  /** Matchup preview totals + win% — same Sleeper starter math as /playbook/matchup. */
  const displayMatchup = useMemo(
    () =>
      computeMatchupPreview({
        mine: {
          team: myTeam,
          points: weeklyPair.myPoints,
          starterIds: weeklyPair.myStarterIds,
          starterNames: weeklyPair.myStarterNames,
          playerPoints: weeklyPair.myPlayerPoints,
        },
        opp: {
          team: oppTeam,
          points: weeklyPair.oppPoints,
          starterIds: weeklyPair.oppStarterIds,
          starterNames: weeklyPair.oppStarterNames,
          playerPoints: weeklyPair.oppPlayerPoints,
        },
        rosterPositions,
        playersById,
        projectFor,
        progressByNflTeam,
        activeWeek: currentWeek ?? 1,
      }),
    [weeklyPair, myTeam, oppTeam, playersById, projectFor, progressByNflTeam, currentWeek, rosterPositions],
  );

  const leagueMatchups = useMemo((): LeagueMatchupPair[] => {
    const entries = matchups?.entries ?? [];
    if (!entries.length) return [];
    const myRosterId = myTeam?.slot ?? teams.find((t) => t.isMine)?.slot ?? null;
    const skip = new Set(
      [myRosterId, weeklyPair.oppRosterId]
        .filter((id): id is number => id != null)
        .map(Number),
    );
    const labels = starterSlotLabels(rosterPositions);
    const activeWeek = currentWeek ?? 1;

    const byMatchup = new Map<number, typeof entries>();
    for (const entry of entries) {
      if (entry.matchupId == null) continue;
      const bucket = byMatchup.get(Number(entry.matchupId)) ?? [];
      bucket.push(entry);
      byMatchup.set(Number(entry.matchupId), bucket);
    }

    const out: LeagueMatchupPair[] = [];
    for (const [id, pair] of [...byMatchup.entries()].sort((x, y) => x[0] - y[0])) {
      const [ea, eb] = pair;
      if (!ea || !eb) continue;
      if (skip.has(Number(ea.rosterId)) || skip.has(Number(eb.rosterId))) continue;

      const resolve = (entry: typeof ea) => {
        const team = teams.find((t) => Number(t.slot) === Number(entry.rosterId)) ?? null;
        const starters = resolveMatchupStarters(
          team,
          labels,
          entry.starters ?? [],
          playersById,
          entry.starterNames ?? [],
        );
        let proj = 0;
        for (const player of starters) {
          if (player.bye != null && Number(player.bye) === Number(activeWeek)) continue;
          proj += projectFor(player.id) ?? matchupWeeklyFallback(player);
        }
        return {
          team,
          starters,
          entry,
          proj: Math.round(proj * 100) / 100,
        };
      };
      const sa = resolve(ea);
      const sb = resolve(eb);

      const { pctA, pctB } = computeDynamicWinProbability({
        scoreA: ea.points,
        scoreB: eb.points,
        startersA: sa.starters,
        startersB: sb.starters,
        pointsMapA: ea.playerPoints ?? {},
        pointsMapB: eb.playerPoints ?? {},
        projectFor,
        weeklyFallback: matchupWeeklyFallback,
        progressByNflTeam,
        activeWeek,
      });

      const allStarters = [...sa.starters, ...sb.starters];
      const started =
        ea.points > 0.005 ||
        eb.points > 0.005 ||
        allStarters.some((p) => {
          const phase = nflTeamPhase(progressByNflTeam, p.team);
          return phase === "in" || phase === "post";
        });
      const final =
        allStarters.length > 0 &&
        allStarters.every(
          (p) =>
            (p.bye != null && Number(p.bye) === Number(activeWeek)) ||
            nflTeamPhase(progressByNflTeam, p.team) === "post",
        );

      const side = (s: typeof sa, winPct: number): LeagueMatchupSide => ({
        rosterId: Number(s.entry.rosterId),
        name: s.team?.team || s.entry.teamName || "Team",
        logo: s.team?.logo || s.entry.logo || null,
        live: s.entry.points,
        proj: s.proj,
        winPct,
      });
      out.push({ id, a: side(sa, pctA), b: side(sb, pctB), started, final });
    }
    return out;
  }, [
    matchups,
    myTeam,
    teams,
    weeklyPair.oppRosterId,
    rosterPositions,
    currentWeek,
    playersById,
    projectFor,
    progressByNflTeam,
  ]);

  const matchupRecordFor = (
    rosterId: number | null | undefined,
    teamName: string,
  ): string | null => {
    const rows = standings?.rows ?? [];
    if (!rows.length) return null;
    const byId =
      rosterId != null
        ? rows.find((r) => Number(r.rosterId) === Number(rosterId))
        : undefined;
    const byName = rows.find(
      (r) => (r.team ?? "").trim().toLowerCase() === teamName.trim().toLowerCase(),
    );
    const row = byId ?? byName;
    if (!row) return null;
    const ties = Number(row.ties ?? 0) || 0;
    return ties > 0 ? `${row.wins}-${row.losses}-${ties}` : `${row.wins}-${row.losses}`;
  };

  const myMatchupName = myTeam?.team || activeLeague?.teamName || "My Team";
  const oppMatchupName =
    weeklyPair.oppName ||
    oppTeam?.team ||
    (weeklyPair.oppRosterId == null && matchups?.entries?.length ? "Bye week" : "Opponent");
  const myMatchupRecord = matchupRecordFor(myTeam?.slot ?? null, myMatchupName);
  const oppMatchupRecord = matchupRecordFor(weeklyPair.oppRosterId, oppMatchupName);

  const newsEvents = useMemo(() => events.slice(0, 5), [events]);

  /** Fresh injury designations, official report lines and news for the synced roster. */
  const rosterIdsKey = useMemo(
    () => (myTeam?.players ?? []).map((p) => p.id).filter(Boolean).sort().join(","),
    [myTeam],
  );
  const rosterNewsQuery = useQuery({
    queryKey: ["roster-news", rosterIdsKey],
    enabled: rosterIdsKey.length > 0,
    retry: false,
    staleTime: 15 * 60 * 1000,
    refetchInterval: (q) =>
      typeof document !== "undefined" && document.visibilityState !== "visible"
        ? false
        : 30 * 60 * 1000,
    refetchIntervalInBackground: false,
    queryFn: async () => fetchSnapRosterNews(rosterIdsKey.split(",")),
  });

  /** Press Room awards from the last completed week (shares the history matchup cache). */
  const awardWeek = completedThrough > 0 ? completedThrough : null;
  const { matchups: awardMatchups } = useActiveMatchups(awardWeek);
  const playersByName = useMemo(() => buildPlayersByName(players), [players]);
  const myAwards = useMemo(() => {
    const entries = awardMatchups?.entries ?? [];
    if (awardWeek == null || entries.length < 2) return [] as AwardRow[];
    const { awards } = buildWeekReport({
      week: awardWeek,
      entries,
      playersById,
      playersByName,
      rosterPositions,
      events,
      teams,
    });
    return awardsForTeam(awards, {
      rosterId: myTeam?.slot ?? teams.find((t) => t.isMine)?.slot ?? null,
      teamName: myTeam?.team ?? activeLeague?.teamName ?? null,
    });
  }, [
    awardMatchups,
    awardWeek,
    playersById,
    playersByName,
    rosterPositions,
    events,
    teams,
    myTeam,
    activeLeague?.teamName,
  ]);

  const insightSlides = useMemo(() => {
    const myPlayers = myTeam?.players ?? [];
    const myStarters = (myTeam?.starters ?? []).filter((p): p is Player => Boolean(p));
    const oppStarters = (oppTeam?.starters ?? []).filter((p): p is Player => Boolean(p));
    return buildTeamInsightSlides({
      myTeamPlayers: myPlayers,
      oppTeamPlayers: oppTeam?.players ?? [],
      myStarters,
      oppStarters,
      progressByNflTeam,
      brain,
      nflWeek: currentWeek,
      rosterNews: rosterNewsQuery.data ?? null,
      awards: myAwards,
    });
  }, [myTeam, oppTeam, progressByNflTeam, brain, currentWeek, rosterNewsQuery.data, myAwards]);

  const { startSitAlerts, startSitLock } = useMemo(() => {
    if (!myTeam) {
      return {
        startSitAlerts: [] as {
          id: string;
          start: Player;
          sit: Player;
          startPts: number;
          sitPts: number;
        }[],
        startSitLock: "none" as "none" | "some" | "all",
      };
    }
    const starters = (myTeam.starters ?? []).filter((p): p is Player => Boolean(p));
    const starterIds = new Set(starters.map((p) => p.id));
    const bench = (myTeam.bench ?? []).filter((p) => !starterIds.has(p.id));

    const nowMs = Date.now();
    const lockedIds = new Set(
      [...starters, ...bench]
        .filter((p) => nflGameLocked(progressByNflTeam, p.team, nowMs))
        .map((p) => p.id),
    );
    const playingThisWeek = [...starters, ...bench].filter((p) => {
      const team = (p.team ?? "").trim().toUpperCase();
      if (!team || team === "FA") return false;
      return !(p.bye != null && currentWeek != null && Number(p.bye) === Number(currentWeek));
    });
    const lockedCount = playingThisWeek.filter((p) => lockedIds.has(p.id)).length;
    const startSitLock: "none" | "some" | "all" =
      lockedCount === 0
        ? "none"
        : lockedCount >= playingThisWeek.length
          ? "all"
          : "some";

    const alerts = buildStartSitAdvice({
      starters,
      bench,
      weeklyFor: (id) => {
        const hit = [...starters, ...bench].find((p) => p.id === id);
        if (
          hit?.bye != null &&
          currentWeek != null &&
          Number(hit.bye) === Number(currentWeek)
        ) {
          return null;
        }
        return projectFor(id);
      },
      minEdge: 0.8,
      limit: 4,
      isLocked: (id) => lockedIds.has(id),
    });
    return { startSitAlerts: alerts, startSitLock };
  }, [myTeam, projectFor, currentWeek, progressByNflTeam]);

  const marketRadar = useMemo(() => {
    const toFit = (p: Player): FitPlayer => ({
      id: p.id,
      pos: p.pos,
      weekly: projectFor(p.id) ?? weeklyFallback(p),
    });
    const starters = starterRequirements(rosterPositions);
    const scoring = { weeklyFor: projectFor };

    const marketValueById: Record<string, number> = {};
    const marketById: Record<
      string,
      { value?: number; trend?: number; sleeperAdds?: number }
    > = {};
    const fc = fantasyCalcMarket.data ?? {};
    for (const p of players) {
      const live = fc[p.id];
      const entry = brain?.[p.id];
      const weekly = projectFor(p.id) ?? weeklyFallback(p);
      // Prefer live FantasyCalc; then brain; then weekly projection × 10 failsafe.
      const value =
        live?.value ??
        entry?.value ??
        (weekly > 0 ? weekly * 10 : Math.max(0, (p.proj?.half ?? 0) / 17) * 10);
      const trend = live?.trend ?? entry?.trend ?? 0;
      const sleeperAdds = trendingAddById.get(p.id) ?? 0;
      if (value) marketValueById[p.id] = value;
      marketById[p.id] = { value, trend, sleeperAdds };
    }

    type RadarTrade = {
      give: Player[];
      get: Player[];
      manager: string;
      fillPos: string;
      packageKind: "1:1" | "2:1" | "2:2";
      myDelta: number;
    };

    let suggestedTrade: RadarTrade | null = null;

    if (myTeam && teams.length > 1) {
      const engineTrade = suggestMarketRadarTrade({
        // Pass full synced team objects so the engine can read `.players`,
        // `.starters`, `.bench`, and `.ir` with multi-key fallbacks.
        myRoster: myTeam,
        myBench: myTeam.bench ?? [],
        opponents: teams
          .filter((t) => !t.isMine && t.slot !== myTeam.slot)
          .map((t) => ({
            slot: t.slot,
            label: t.team?.trim() || t.owner?.trim() || "Manager",
            roster: t,
            players: t.players,
          })),
        starters,
        scoring,
        marketValueById,
      });

      if (engineTrade) {
        const give = engineTrade.give
          .map((f) => (f.id ? playersById.get(f.id) ?? myTeam.players.find((p) => p.id === f.id) : null))
          .filter((p): p is Player => Boolean(p));
        const get = engineTrade.get
          .map((f) => {
            if (!f.id) return null;
            return (
              playersById.get(f.id) ??
              teams.flatMap((t) => t.players).find((p) => p.id === f.id) ??
              null
            );
          })
          .filter((p): p is Player => Boolean(p));
        if (give.length && get.length) {
          suggestedTrade = {
            give,
            get,
            manager: engineTrade.managerLabel,
            fillPos: engineTrade.fillPos,
            packageKind: engineTrade.packageKind,
            myDelta: engineTrade.myDelta,
          };
        }
      }
    }

    const rosteredIds = new Set<string>();
    for (const team of teams) {
      for (const p of team.players) rosteredIds.add(p.id);
    }

    const gamePhaseByTeam: Record<string, string> = {};
    for (const [team, progress] of progressByNflTeam.entries()) {
      const key = team.trim().toUpperCase();
      if (!key) continue;
      gamePhaseByTeam[key] = progress.phase;
    }

    const injuryById: Record<string, string> = {};
    for (const p of players) {
      const status = (p.injury || p.injury_status || "").trim();
      if (status) injuryById[p.id] = status;
    }

    const freeAgents = players
      .filter((p) => !rosteredIds.has(p.id))
      .map((p) => {
        // Adds must have a real weekly projection, never a season-pace estimate.
        const fit: FitPlayer = { ...toFit(p), weekly: projectFor(p.id) ?? 0 };
        const team = (p.team || "").trim().toUpperCase();
        const phase = team ? gamePhaseByTeam[team] : undefined;
        const gameStatus =
          phase === "in" ? "in_progress" : phase === "post" ? "done" : phase === "pre" ? "pre" : null;
        return {
          ...fit,
          name: p.name,
          team: p.team,
          injury_status: p.injury || p.injury_status || null,
          injuryStatus: p.injury || p.injury_status || null,
          gamePhase: phase ?? null,
          gameStatus,
        };
      })
      .sort((a, b) => b.weekly - a.weekly)
      .slice(0, 160);

    const engineWaivers =
      myTeam && freeAgents.length
        ? suggestWaiverTransactions({
            roster: myTeam.players.map(toFit),
            bench: (myTeam.bench ?? []).map(toFit),
            freeAgents,
            starters,
            scoring,
            limit: 2,
            marketById,
            gamePhaseByTeam,
            injuryById,
          })
        : [];

    const waiverTargets = engineWaivers
      .map((row) => {
        const addId = row.add.id ?? "";
        const dropId = row.drop.id ?? "";
        const add =
          playersById.get(addId) ?? players.find((p) => p.id === addId) ?? null;
        const drop =
          myTeam?.players.find((p) => p.id === dropId) ??
          playersById.get(dropId) ??
          null;
        if (!add || !drop) return null;
        return {
          add,
          drop,
          addProj: projectFor(addId) ?? row.addProj,
          dropProj: projectFor(dropId),
          netValue: row.netValue,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    return { suggestedTrade, waiverTargets };
  }, [
    myTeam,
    teams,
    rosterPositions,
    players,
    playersById,
    brain,
    projectFor,
    trendingAddById,
    fantasyCalcMarket.data,
    progressByNflTeam,
  ]);

  const leaderboard = powerRows.slice(0, 5);
  const logoBySlot = useMemo(() => {
    const map = new Map<number, string | null>();
    for (const team of teams) map.set(team.slot, team.logo);
    return map;
  }, [teams]);
  const leagueCacheKey = activeLeague?.id ?? "none";

  const leagueSettingsQuery = useQuery({
    queryKey: ["dashboard-league-settings", activeLeague?.id ?? null],
    enabled: Boolean(activeLeague?.leagueId),
    retry: false,
    staleTime: 60 * 60 * 1000,
    queryFn: async () =>
      fetchLeagueSettingsForConnection({
        leagueId: activeLeague?.leagueId ?? "",
        platform: (activeLeague?.platform ?? "sleeper").trim().toLowerCase(),
        teamName: activeLeague?.teamName,
        ...(activeLeague?.s2 ? { s2: activeLeague.s2 } : {}),
        ...(activeLeague?.swid ? { swid: activeLeague.swid } : {}),
      }),
  });

  const standingsTable = useMemo(() => {
    const rows = standings?.rows ?? [];
    if (!rows.length) return null;

    const results = new Map<number, ("W" | "L" | "T")[]>();
    for (let index = 0; index < completedWeekNumbers.length; index += 1) {
      const entries = leagueAnalytics.historyQueries[index]?.data?.entries ?? [];
      const byMatchup = new Map<number, typeof entries>();
      for (const entry of entries) {
        if (entry.matchupId == null) continue;
        const bucket = byMatchup.get(Number(entry.matchupId)) ?? [];
        bucket.push(entry);
        byMatchup.set(Number(entry.matchupId), bucket);
      }
      for (const [a, b] of byMatchup.values()) {
        if (!a || !b || (a.points <= 0 && b.points <= 0)) continue;
        const diff = a.points - b.points;
        const ra = Math.abs(diff) < 0.005 ? "T" : diff > 0 ? "W" : "L";
        const rb = ra === "T" ? "T" : ra === "W" ? "L" : "W";
        results.set(Number(a.rosterId), [...(results.get(Number(a.rosterId)) ?? []), ra]);
        results.set(Number(b.rosterId), [...(results.get(Number(b.rosterId)) ?? []), rb]);
      }
    }

    const myRosterId = myTeam?.slot ?? teams.find((t) => t.isMine)?.slot ?? null;
    const streakFrom = (list: ("W" | "L" | "T")[]): string | null => {
      const latest = list.at(-1);
      if (!latest) return null;
      let count = 0;
      for (let i = list.length - 1; i >= 0 && list[i] === latest; i -= 1) count += 1;
      return `${count}${latest}`;
    };
    const out = rows.map((row, index) => ({
      ...row,
      rank: index + 1,
      streak: row.streak ?? streakFrom(results.get(Number(row.rosterId)) ?? []),
      last: (results.get(Number(row.rosterId)) ?? []).slice(-3),
      isMine: myRosterId != null && Number(row.rosterId) === Number(myRosterId),
    }));

    const playoffTeams = leagueSettingsQuery.data?.playoffTeams ?? null;
    const cut = playoffTeams && playoffTeams < out.length ? playoffTeams : null;

    let summary: string | null = null;
    const mine = out.find((r) => r.isMine);
    if (mine && cut) {
      const gamesAhead = (a: StandingRowLike, b: StandingRowLike) =>
        (a.wins - b.wins + (b.losses - a.losses)) / 2;
      const games = (n: number) =>
        `${Number.isInteger(n) ? n : n.toFixed(1)} ${n === 1 ? "game" : "games"}`;
      if (mine.rank <= cut) {
        const firstOut = out[cut];
        const lead = firstOut ? gamesAhead(mine, firstOut) : 0;
        summary =
          lead > 0
            ? `You hold the ${ordinalPlace(mine.rank)} seed, ${games(lead)} clear of the playoff line.`
            : `You hold the ${ordinalPlace(mine.rank)} seed, level on record with the first team out.`;
      } else {
        const lastIn = out[cut - 1];
        const back = lastIn ? gamesAhead(lastIn, mine) : 0;
        summary =
          back > 0
            ? `You're ${games(back)} out of the final playoff spot.`
            : "You're level on record with the final playoff spot and trail on points.";
      }
    }

    return { rows: out, cut, summary };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- historyStamp
  }, [standings, historyStamp, leagueSettingsQuery.data, myTeam, teams, completedWeekNumbers.length]);

  const [rankBaseline, setRankBaseline] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    setRankBaseline(resolvePowerRankDisplayBaseline(leagueCacheKey, powerRows));
  }, [leagueCacheKey, powerRows]);

  return (
    <div>
      <header className="mb-1">
        <h1 className="display-title text-3xl">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {activeLeague?.name?.trim() || "Active league"} weekly command view.
        </p>
      </header>

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full mb-6 select-none">
            <div className="flex items-center space-x-3.5 p-3.5 bg-white border border-slate-100 rounded-2xl shadow-sm h-[84px] w-full">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white shrink-0 shadow-sm">
                <svg
                  className="size-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 13h4v8H3v-8zm6-7h4v15H9V6zm6 9h4v6h-4v-6z"
                  />
                </svg>
              </div>
              <div className="flex flex-col text-left min-w-0">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Standings
                </span>
                <div className="flex items-baseline space-x-1.5 mt-0.5">
                  <span className="text-lg font-black text-slate-900 leading-none">
                    {synchronizedWeeklyMetrics.position}
                  </span>
                  <span
                    className={cn(
                      "text-xs font-black font-mono leading-none",
                      recordToneClass(synchronizedWeeklyMetrics.record),
                    )}
                  >
                    {synchronizedWeeklyMetrics.record}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-3.5 p-3.5 bg-white border border-slate-100 rounded-2xl shadow-sm h-[84px] w-full">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white shrink-0 shadow-sm">
                <Target className="size-5" strokeWidth={2.5} />
              </div>
              <div className="flex flex-col text-left min-w-0">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Avg. Points
                </span>
                <div className="mt-0.5 flex items-baseline gap-1.5">
                  <span className="text-lg font-black text-slate-900 font-mono leading-none">
                    {synchronizedWeeklyMetrics.avgPoints}
                  </span>
                  <MetricDeltaPct deltaPct={synchronizedWeeklyMetrics.avgPointsDeltaPct} />
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-3.5 p-3.5 bg-white border border-slate-100 rounded-2xl shadow-sm h-[84px] w-full">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white shrink-0 shadow-sm">
                <Gauge className="size-5" strokeWidth={2.5} />
              </div>
              <div className="flex flex-col text-left min-w-0 flex-1">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider block whitespace-nowrap">
                  Coaching Efficiency
                </span>
                <div className="mt-0.5 flex items-baseline gap-1.5">
                  <span className="text-lg font-black text-slate-900 font-mono leading-none">
                    {synchronizedWeeklyMetrics.efficiency}
                  </span>
                  <MetricDeltaPct deltaPct={synchronizedWeeklyMetrics.efficiencyDeltaPct} />
                </div>
              </div>
            </div>
          </div>

          <Panel
            title="Matchups"
            badge={
              <span className="rounded-lg border border-border bg-slate-50 px-2.5 py-0.5 text-[11px] font-bold text-slate-600">
                Week {currentWeek ?? 1}
              </span>
            }
            action={{ to: "/playbook/matchup", label: "View Matchup" }}
          >
            <MatchupPreviewCard
              loading={loading}
              leagueId={activeLeague?.id ?? null}
              platform={activeLeague?.platform ?? null}
              myName={myMatchupName}
              myLogo={myTeam?.logo ?? activeLeague?.avatar ?? null}
              myRecord={myMatchupRecord}
              myLive={weeklyPair.myPoints}
              myProj={displayMatchup.myOrigProj}
              myWinPct={displayMatchup.myWinPct}
              oppName={oppMatchupName}
              oppLogo={weeklyPair.oppLogo || oppTeam?.logo || null}
              oppRecord={oppMatchupRecord}
              oppLive={weeklyPair.oppPoints}
              oppProj={displayMatchup.oppOrigProj}
              oppWinPct={displayMatchup.oppWinPct}
              weekStarted={displayMatchup.weekStarted}
              matchupFinal={displayMatchup.matchupFinal}
            />
            {!loading && leagueMatchups.length ? (
              <div className="mt-5 border-t border-slate-200 pt-4">
                <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Around the League
                </span>
                <ul className="divide-y divide-slate-100">
                  {leagueMatchups.map((pair) => (
                    <LeagueMatchupRow
                      key={`${leagueCacheKey}-${pair.id}`}
                      pair={pair}
                      platform={activeLeague?.platform ?? null}
                      cacheKey={`${leagueCacheKey}-lm`}
                      recordFor={matchupRecordFor}
                    />
                  ))}
                </ul>
              </div>
            ) : null}
          </Panel>

          <TeamInsightsCarousel
            slides={insightSlides}
            resetKey={leagueCacheKey}
            platform={activeLeague?.platform ?? null}
          />

          <Panel
            title="Standings"
            action={{ to: "/standings", label: "Full Standings" }}
          >
            {standingsLoading && !standingsTable ? (
              <p className="text-sm text-muted-foreground">Loading standings…</p>
            ) : !standingsTable ? (
              <p className="text-sm text-muted-foreground">No standings available yet.</p>
            ) : (
              <div className="w-full min-w-0">
                <div className="grid w-full grid-cols-[2rem_minmax(0,1fr)_3.25rem_3.5rem_4.25rem_4.25rem_4.5rem] items-center gap-x-2 px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <span className="text-center">Rank</span>
                  <span>Team</span>
                  <span className="text-center">Streak</span>
                  <span className="text-center">W-L</span>
                  <span className="text-right">PF</span>
                  <span className="text-right">PA</span>
                  <span className="text-right">Last 3</span>
                </div>
                <ol className="w-full min-w-0">
                  {standingsTable.rows.map((row) => {
                    const inPlayoffs = standingsTable.cut != null && row.rank <= standingsTable.cut;
                    const record =
                      row.ties > 0
                        ? `${row.wins}-${row.losses}-${row.ties}`
                        : `${row.wins}-${row.losses}`;
                    return (
                      <li key={`${leagueCacheKey}-st-${row.rosterId}`}>
                        <div
                          className={cn(
                            "grid w-full min-w-0 grid-cols-[2rem_minmax(0,1fr)_3.25rem_3.5rem_4.25rem_4.25rem_4.5rem] items-center gap-x-2 rounded-md px-2 py-2",
                            row.isMine && "bg-blue-50/80",
                          )}
                        >
                          <span
                            className={cn(
                              "text-center text-sm font-bold tabular-nums",
                              standingsTable.cut == null || inPlayoffs
                                ? "text-slate-900"
                                : "text-slate-400",
                            )}
                          >
                            {row.rank}
                          </span>
                          <Link
                            to="/playbook/rosters"
                            search={{ scout: String(row.rosterId) }}
                            className="flex min-w-0 items-center gap-2 overflow-hidden transition-opacity hover:opacity-85"
                          >
                            <MatchupTeamAvatar
                              name={row.team}
                              logo={logoBySlot.get(row.rosterId) ?? row.avatar ?? null}
                              platform={activeLeague?.platform ?? null}
                              cacheKey={`${leagueCacheKey}-st-${row.rosterId}`}
                              size="sm"
                            />
                            <span className="min-w-0 flex-1 overflow-hidden">
                              <span className="block truncate text-sm font-medium text-foreground">
                                {row.team}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {row.owner || "Owner"}
                              </span>
                            </span>
                          </Link>
                          <span className="text-center">
                            <StreakIndicator streak={row.streak} />
                          </span>
                          <span
                            className={cn(
                              "text-center text-sm font-semibold tabular-nums",
                              recordToneClass(record),
                            )}
                          >
                            {record}
                          </span>
                          <span className="text-right text-sm tabular-nums text-foreground">
                            {row.pointsFor.toFixed(1)}
                          </span>
                          <span className="text-right text-sm tabular-nums text-slate-500">
                            {row.pointsAgainst.toFixed(1)}
                          </span>
                          <span className="flex justify-end gap-1">
                            {row.last.length ? (
                              row.last.map((result, idx) => (
                                <span
                                  key={idx}
                                  className={cn(
                                    "flex size-5 items-center justify-center rounded text-[10px] font-bold",
                                    result === "W"
                                      ? "bg-emerald-100 text-emerald-700"
                                      : result === "L"
                                        ? "bg-rose-100 text-rose-600"
                                        : "bg-slate-100 text-slate-500",
                                  )}
                                >
                                  {result}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-slate-300">-</span>
                            )}
                          </span>
                        </div>
                        {standingsTable.cut != null && row.rank === standingsTable.cut ? (
                          <div className="my-1 flex items-center gap-2 px-2" aria-label="Playoff line">
                            <span className="h-px flex-1 border-t border-dashed border-emerald-400" />
                            <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600">
                              Playoff Line
                            </span>
                            <span className="h-px flex-1 border-t border-dashed border-emerald-400" />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
                {standingsTable.summary ? (
                  <p className="mt-3 border-t border-slate-100 pt-3 text-xs font-medium text-slate-500">
                    {standingsTable.summary}
                  </p>
                ) : null}
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-6 lg:col-span-1">
          <Panel
            title="Power Rankings"
            action={{ to: "/standings", search: { tab: "power" }, label: "Full Rankings" }}
          >
            {loading && !leaderboard.length ? (
              <p className="text-sm text-muted-foreground">Calculating power index…</p>
            ) : !leaderboard.length ? (
              <p className="text-sm text-muted-foreground">No rankings available yet.</p>
            ) : (
              <div className="w-full min-w-0">
                <div className="grid w-full grid-cols-[2.75rem_2.75rem_minmax(0,1fr)_4rem] items-center gap-x-2 pb-1">
                  <span className="text-center text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Rank
                  </span>
                  <span className="text-center text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Trend
                  </span>
                  <span className="text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Team
                  </span>
                  <span className="text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Power Index
                  </span>
                </div>
                <ol className="w-full min-w-0">
                  {leaderboard.map((row) => {
                    const delta = powerRankMovementDelta(rankBaseline, row.slot, row.rank);
                    const trend = powerRankTrend(delta);
                    const podiumRow = powerRankPodiumRowClass(row.rank);
                    const isMine = Boolean(myTeam && row.slot === myTeam.slot);
                    return (
                      <li
                        key={`${leagueCacheKey}-${row.slot}`}
                        className={cn(
                          "grid w-full min-w-0 grid-cols-[2.75rem_2.75rem_minmax(0,1fr)_4rem] items-center gap-x-2 py-2.5",
                          podiumRow || (isMine ? "rounded-md bg-blue-50/80" : undefined),
                        )}
                      >
                        <span className="flex justify-center">
                          <span className={powerRankBadgeClass(row.rank)}>{row.rank}</span>
                        </span>
                        <span className={cn("text-center", trend.className)}>{trend.label}</span>
                        <Link
                          to="/playbook/rosters"
                          search={{ scout: String(row.slot) }}
                          className="flex min-w-0 items-center gap-2 overflow-hidden transition-opacity hover:opacity-85"
                        >
                          <MatchupTeamAvatar
                            name={row.team}
                            logo={logoBySlot.get(row.slot) ?? null}
                            platform={activeLeague?.platform ?? null}
                            cacheKey={`${leagueCacheKey}-rank-${row.slot}`}
                            size="sm"
                          />
                          <span className="min-w-0 flex-1 overflow-hidden">
                            <span className="block truncate text-sm font-medium text-foreground">
                              {row.team}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {row.owner || "Owner"}
                            </span>
                          </span>
                        </Link>
                        <span className="text-right text-sm font-semibold tabular-nums text-foreground">
                          {row.powerIndex.toFixed(1)}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
          </Panel>

          <Panel
            title="Start/Sit Advice"
            action={{ to: "/playbook/my-team", label: "Review Lineup" }}
          >
            {!startSitAlerts.length ? (
              <div className="mt-1.5 flex w-full select-none items-center space-x-4 overflow-hidden rounded-xl border border-slate-100 bg-slate-50/40 p-4 text-left shadow-sm">
                <span
                  className={cn(
                    "flex flex-shrink-0 items-center justify-center rounded px-2 py-0.5 text-[9px] font-extrabold tracking-wider uppercase shadow-sm",
                    startSitLock === "all"
                      ? "bg-slate-200 text-slate-700"
                      : "bg-emerald-100 text-emerald-800",
                  )}
                >
                  {startSitLock === "all" ? "LOCKED" : "OPTIMIZED"}
                </span>
                <div className="flex min-w-0 flex-col items-start text-left">
                  <span className="block w-full truncate text-xs font-black tracking-wide text-slate-900">
                    {startSitLock === "all"
                      ? "Games Have Started"
                      : startSitLock === "some"
                        ? "No Available Moves"
                        : "Your Starting Lineup is Locked"}
                  </span>
                  <span className="mt-0.5 block w-full text-[11px] font-bold text-slate-400">
                    {startSitLock === "all"
                      ? "All of your players' games have kicked off. No lineup moves remain this week."
                      : startSitLock === "some"
                        ? "Games are underway. Players whose games have kicked off are locked and left out of this advice."
                        : "No projection upgrades detected on your bench slots."}
                  </span>
                </div>
              </div>
            ) : (
              <div className="w-full">
                {startSitAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="mb-3 grid w-full grid-cols-[1fr_40px_1fr] items-center overflow-hidden rounded-xl border border-slate-100 bg-slate-50/40 p-4"
                  >
                    {/* START — badge top, identity horizontal */}
                    <button
                      type="button"
                      onClick={() => openPlayer(alert.start.id)}
                      className="flex min-w-0 flex-1 flex-col items-start space-y-2.5 text-left transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      <span className="flex-shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black tracking-wider text-emerald-800">
                        START
                      </span>
                      <div className="flex w-full min-w-0 items-center space-x-3">
                        <PlayerAvatar
                          id={alert.start.id}
                          pos={alert.start.pos}
                          team={alert.start.team}
                          name={alert.start.name}
                          className="relative h-10 w-10 flex-shrink-0 rounded-full border border-slate-100 bg-white object-cover"
                          logoClassName="size-3.5"
                        />
                        <div className="flex min-w-0 flex-1 flex-col text-left">
                          <span className="block max-w-[85px] truncate text-left text-xs font-black text-slate-900 lg:max-w-[100px]">
                            {alert.start.name}
                          </span>
                          <span className="mt-0.5 text-[11px] font-bold text-slate-500">
                            {alert.startPts.toFixed(1)} Proj
                          </span>
                        </div>
                      </div>
                    </button>

                    {/* Mid seam */}
                    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-center text-[9px] font-black text-slate-400 shadow-sm">
                      vs
                    </div>

                    {/* SIT — badge top, identity horizontal mirrored */}
                    <button
                      type="button"
                      onClick={() => openPlayer(alert.sit.id)}
                      className="flex min-w-0 flex-1 flex-col items-end space-y-2.5 text-right transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      <span className="flex-shrink-0 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-black tracking-wider text-rose-800">
                        SIT
                      </span>
                      <div className="flex w-full min-w-0 items-center justify-end space-x-3">
                        <div className="flex min-w-0 flex-1 flex-col items-end text-right">
                          <span className="block max-w-[85px] truncate text-right text-xs font-black text-slate-900 lg:max-w-[100px]">
                            {alert.sit.name}
                          </span>
                          <span className="mt-0.5 text-[11px] font-bold text-slate-500">
                            {alert.sitPts.toFixed(1)} Proj
                          </span>
                        </div>
                        <PlayerAvatar
                          id={alert.sit.id}
                          pos={alert.sit.pos}
                          team={alert.sit.team}
                          name={alert.sit.name}
                          className="relative h-10 w-10 flex-shrink-0 rounded-full border border-slate-100 bg-white object-cover"
                          logoClassName="size-3.5"
                        />
                      </div>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="Market Radar"
            action={{ to: "/playbook/rosters", label: "Scout Rosters" }}
          >
            <div className="space-y-4">
              <div>
                <span className="mb-2.5 block text-[10px] font-black tracking-wider text-blue-600">
                  SUGGESTED WIN-WIN TRADE
                </span>
                {marketRadar.suggestedTrade ? (
                  <div>
                    <div className="flex flex-wrap items-center justify-start gap-2">
                      <div className="flex items-center -space-x-1.5">
                        {marketRadar.suggestedTrade.give.map((p) => (
                          <button
                            key={`give-${p.id}`}
                            type="button"
                            onClick={() => openPlayer(p.id)}
                            className="transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                            aria-label={p.name}
                          >
                            <PlayerAvatar
                              id={p.id}
                              pos={p.pos}
                              team={p.team}
                              name={p.name}
                              className="relative h-10 w-10 flex-shrink-0 rounded-full border border-slate-100 bg-white object-cover"
                              logoClassName="size-3.5"
                            />
                          </button>
                        ))}
                      </div>
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-sm font-bold text-emerald-700">
                        ⇄
                      </div>
                      <div className="flex items-center -space-x-1.5">
                        {marketRadar.suggestedTrade.get.map((p) => (
                          <button
                            key={`get-${p.id}`}
                            type="button"
                            onClick={() => openPlayer(p.id)}
                            className="transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                            aria-label={p.name}
                          >
                            <PlayerAvatar
                              id={p.id}
                              pos={p.pos}
                              team={p.team}
                              name={p.name}
                              className="relative h-10 w-10 flex-shrink-0 rounded-full border border-slate-100 bg-white object-cover"
                              logoClassName="size-3.5"
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className="mt-2.5 text-left text-sm font-medium text-slate-600">
                      {marketRadar.suggestedTrade.packageKind !== "1:1" ? (
                        <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-900">
                          {marketRadar.suggestedTrade.packageKind === "2:1"
                            ? "Suggested 2-for-1 package"
                            : "Suggested 2-for-2 package"}
                        </span>
                      ) : null}
                      Trade{" "}
                      {marketRadar.suggestedTrade.give.map((p, idx) => (
                        <span key={`give-name-${p.id}`}>
                          {idx > 0
                            ? idx === marketRadar.suggestedTrade!.give.length - 1
                              ? " and "
                              : ", "
                            : null}
                          <button
                            type="button"
                            onClick={() => openPlayer(p.id)}
                            className="font-semibold text-slate-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                          >
                            {p.name}
                          </button>
                        </span>
                      ))}{" "}
                      to {marketRadar.suggestedTrade.manager} for{" "}
                      {marketRadar.suggestedTrade.get.map((p, idx) => (
                        <span key={`get-name-${p.id}`}>
                          {idx > 0
                            ? idx === marketRadar.suggestedTrade!.get.length - 1
                              ? " and "
                              : ", "
                            : null}
                          <button
                            type="button"
                            onClick={() => openPlayer(p.id)}
                            className="font-semibold text-slate-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                          >
                            {p.name}
                          </button>
                        </span>
                      ))}{" "}
                      to instantly patch your {marketRadar.suggestedTrade.fillPos} depth gap.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No clear win-win 1:1 or package trade surfaced against synced league rosters.
                  </p>
                )}
              </div>

              {marketRadar.waiverTargets.length ? (
                marketRadar.waiverTargets.map((target) => (
                  <div key={`${target.drop.id}-${target.add.id}`}>
                    <span className="mb-2.5 block text-[10px] font-black tracking-wider text-emerald-600">
                      SUGGESTED WAIVER ADD
                    </span>
                    <div className="mb-3 flex w-full flex-col space-y-3 rounded-xl border border-slate-100 bg-slate-50/40 p-3 text-left shadow-inner-sm">
                      {/* ROW 1 — ADD */}
                      <button
                        type="button"
                        onClick={() => openPlayer(target.add.id)}
                        className="flex w-full items-center space-x-3 text-left transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        <span className="flex-shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-black tracking-wider text-emerald-800">
                          + ADD
                        </span>
                        <PlayerAvatar
                          id={target.add.id}
                          pos={target.add.pos}
                          team={target.add.team}
                          name={target.add.name}
                          className="relative h-9 w-9 flex-shrink-0 rounded-full border border-slate-100 bg-white object-cover"
                          logoClassName="size-3"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-black text-slate-900">
                            {target.add.name} {target.add.pos}
                          </span>
                          <span className="mt-0.5 block text-[10px] font-medium uppercase text-slate-400">
                            {target.add.team || "FA"}
                            {target.add.bye != null ? ` - BYE: ${target.add.bye}` : ""}
                          </span>
                        </span>
                        <span className="ml-auto text-xs font-bold text-slate-800">
                          +{target.addProj.toFixed(1)} Proj
                        </span>
                      </button>

                      {/* ROW 2 — DROP */}
                      <button
                        type="button"
                        onClick={() => openPlayer(target.drop.id)}
                        className="flex w-full items-center space-x-3 text-left transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        <span className="flex-shrink-0 rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-black tracking-wider text-rose-800">
                          - DROP
                        </span>
                        <PlayerAvatar
                          id={target.drop.id}
                          pos={target.drop.pos}
                          team={target.drop.team}
                          name={target.drop.name}
                          className="relative h-9 w-9 flex-shrink-0 rounded-full border border-slate-100 bg-white object-cover"
                          logoClassName="size-3"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-black text-slate-900">
                            {target.drop.name} {target.drop.pos}
                          </span>
                          <span className="mt-0.5 block text-[10px] font-medium uppercase text-slate-400">
                            {target.drop.team || "FA"}
                            {target.drop.bye != null ? ` - BYE: ${target.drop.bye}` : ""}
                          </span>
                        </span>
                        <span className="ml-auto text-xs font-bold text-slate-800">
                          {target.dropProj != null ? `-${target.dropProj.toFixed(1)} Proj` : "No Proj"}
                        </span>
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div>
                  <span className="mb-2.5 block text-[10px] font-black tracking-wider text-emerald-600">
                    SUGGESTED WAIVER ADD
                  </span>
                  <p className="text-sm text-muted-foreground">
                    No positive net-value waiver adds available without harming roster balance.
                  </p>
                </div>
              )}
            </div>
          </Panel>

          <Panel
            title="League Activity"
            action={{ to: "/playbook/transactions", label: "Open Transactions" }}
          >
            {activityLoading ? (
              <p className="text-sm text-muted-foreground">Loading league activity…</p>
            ) : (
              <ActivityFeed
                events={newsEvents}
                players={players}
                compact
                emptyMessage="No recent transactions recorded. Summaries will appear here after the next league moves."
              />
            )}
          </Panel>
        </div>
      </div>

      <PlayerModalHost ref={modalRef} />
    </div>
  );
}
