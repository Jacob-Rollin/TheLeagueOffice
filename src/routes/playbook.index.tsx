import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import {
  resolveAvatarUrl,
  ActivityFeed,
  resolvePowerRankDisplayBaseline,
  powerRankMovementDelta,
} from "@/components/playbook/panels";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useActiveMatchups } from "@/hooks/useActiveMatchups";
import { useActiveStandings } from "@/hooks/useActiveStandings";
import { useLeagueActivity } from "@/hooks/useLeagueActivity";
import { useLeagueProjections } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useNflGameProgress } from "@/hooks/useNflGameProgress";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Player } from "@/lib/draft";
import type { BrainMatrix } from "@/lib/playerBrainHydration";
import { buildTruePowerRankings, starterRequirements } from "@/lib/power-rankings";
import {
  computeTeamDisplayProjection,
  winPctFromDisplayProjections,
  type NflGameProgress,
} from "@/lib/rolling-live-projection";
import {
  loadFantasyCalcMarketMap,
  scaleValue,
  suggestMarketRadarTrade,
  suggestWaiverTransactions,
  type FitPlayer,
} from "@/lib/trade-engine";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/playbook/")({
  ssr: false,
  component: PlaybookDashboardPage,
});

const panelClass = "rounded-xl border border-border bg-card p-4 sm:p-5";
const panelTitleClass = "text-xs font-bold uppercase tracking-wider text-slate-500";
const weeklyFallback = (p: Player) => Math.max(0, (p.proj?.half ?? 0) / 17);

function Panel({
  title,
  action,
  children,
  className,
  titleClassName,
}: {
  title: string;
  action?: {
    to: "/playbook/rankings" | "/playbook/matchup" | "/playbook/transactions" | "/playbook/my-team" | "/playbook/rosters";
    label: string;
  };
  children: ReactNode;
  className?: string;
  titleClassName?: string;
}) {
  return (
    <section className={cn(panelClass, className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className={cn(panelTitleClass, titleClassName)}>{title}</h2>
        {action ? (
          <Link to={action.to} className="text-xs font-semibold text-primary hover:underline">
            {action.label}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function teamInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "TM";
  const letters = cleaned.replace(/[^a-zA-Z0-9]/g, "");
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

function MatchupTeamAvatar({
  name,
  logo,
  platform,
  cacheKey,
  size = "md",
}: {
  name: string;
  logo?: string | null;
  platform?: string | null;
  cacheKey?: string | null;
  size?: "md" | "sm";
}) {
  const [failed, setFailed] = useState(false);
  const src = resolveAvatarUrl(logo);
  const plat = (platform ?? "").trim().toLowerCase();
  const remountKey = `${cacheKey ?? "matchup"}:${src ?? "none"}:${plat}`;
  const box = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const espnImg = size === "sm" ? "h-5 w-5" : "h-7 w-7";
  const initials = size === "sm" ? "text-[10px]" : "text-xs";

  useEffect(() => {
    setFailed(false);
  }, [src, cacheKey, plat]);

  if (src && !failed) {
    return (
      <span
        key={remountKey}
        className={cn(
          "flex shrink-0 overflow-hidden rounded-lg border border-slate-200/80 bg-slate-50",
          box,
        )}
      >
        <img
          key={remountKey}
          src={src}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  if (plat === "espn") {
    return (
      <span
        key={remountKey}
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200/80 bg-white p-1",
          box,
        )}
      >
        <img src="/espn.png" alt="ESPN" className={cn(espnImg, "object-contain")} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      key={remountKey}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg border border-slate-200/80 bg-slate-50 font-bold text-slate-600",
        box,
        initials,
      )}
    >
      {teamInitials(name)}
    </span>
  );
}

function powerRankBadgeClass(rank: number): string {
  if (rank === 1) {
    return "rounded-md border border-amber-200/50 bg-amber-100/70 px-2 py-0.5 text-xs font-bold text-amber-800";
  }
  if (rank === 2) {
    return "rounded-md border border-slate-200/60 bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-800";
  }
  if (rank === 3) {
    return "rounded-md border border-orange-200/40 bg-orange-100/60 px-2 py-0.5 text-xs font-black text-orange-800";
  }
  return "rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-500";
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

type InsightActionTo =
  | "/playbook/rankings"
  | "/playbook/matchup"
  | "/playbook/transactions"
  | "/playbook/my-team"
  | "/playbook/rosters";

type InsightSlide = {
  id: string;
  tag: string;
  headline: string;
  body: string;
  player: Player | null;
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

function buildTeamInsightSlides(opts: {
  myTeamPlayers: Player[];
  oppTeamPlayers: Player[];
  myStarters: Player[];
  oppStarters: Player[];
  progressByNflTeam: Map<string, NflGameProgress>;
  brain: BrainMatrix | null;
}): InsightSlide[] {
  const { myTeamPlayers, myStarters, oppStarters, progressByNflTeam, brain } = opts;
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

    slides.push({
      id: "watch-tonight",
      tag: "What to Watch Tonight",
      headline:
        tonightCount > 0
          ? `${tonightCount} Player${tonightCount === 1 ? "" : "s"} on ${windowTitle}`
          : `No ${windowTitle} Assets Locked In`,
      body: featuredTonight
        ? mineTonight.some((p) => p.id === featuredTonight.id)
          ? `You have ${featuredTonight.name} kicking off tonight.`
          : `Your opponent has ${featuredTonight.name} playing tonight.`
        : "No starters are scheduled in tonight's window yet. Check back as the slate firms up.",
      player: featuredTonight,
      action: { to: "/playbook/matchup", label: "See Full Matchup" },
    });
  }

  const injured = myTeamPlayers.filter(isActiveInjury);
  const newsPlayer =
    injured.find((p) => Boolean(brain?.[p.id]?.injuryNotes?.trim())) ?? injured[0] ?? null;
  const injuryLabel = newsPlayer
    ? (newsPlayer.injury || newsPlayer.injury_status || "Injury").trim()
    : "";
  const injuryType = newsPlayer ? (brain?.[newsPlayer.id]?.injuryType ?? "").trim() : "";
  const injuryNotes = newsPlayer ? (brain?.[newsPlayer.id]?.injuryNotes ?? "").trim() : "";

  slides.push({
    id: "player-news",
    tag: "Player News",
    headline: newsPlayer
      ? `${newsPlayer.name} (${injuryLabel})${injuryType ? ` — ${injuryType}` : ""}`
      : "Roster Clear on Injury Desk",
    body: newsPlayer
      ? injuryNotes ||
        `${newsPlayer.name} is currently listed ${injuryLabel}. Monitor practice reports before lock.`
      : "No active O, IR, Q, or NA designations on your roster right now.",
    player: newsPlayer,
    action: { to: "/playbook/my-team", label: "View All Team News" },
  });

  const notePlayer =
    myTeamPlayers.find((p) => Boolean(brain?.[p.id]?.injuryNotes?.trim())) ??
    [...myTeamPlayers].sort(
      (a, b) => (brain?.[b.id]?.value ?? 0) - (brain?.[a.id]?.value ?? 0),
    )[0] ??
    null;
  const noteEntry = notePlayer ? brain?.[notePlayer.id] : null;
  const noteTrend = noteEntry?.trend ?? 0;
  const noteValue = scaleValue(noteEntry?.value ?? 0);
  const noteBody = notePlayer
    ? noteEntry?.injuryNotes?.trim() ||
      `${notePlayer.name} holds a Value/Trend of ${noteValue.toFixed(1)} with ${
        noteTrend > 0.2 ? "rising" : noteTrend < -0.2 ? "cooling" : "stable"
      } market movement across the latest projection window.`
    : "Sync a roster to unlock long-form player notes and projection context.";

  slides.push({
    id: "player-notes",
    tag: "Player Notes",
    headline: notePlayer ? notePlayer.name : "Team Notes Queue",
    body: noteBody,
    player: notePlayer,
    action: { to: "/playbook/my-team", label: "View All Team Notes" },
  });

  return slides;
}

function TeamInsightsCarousel({
  slides,
  resetKey,
}: {
  slides: InsightSlide[];
  resetKey: string;
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
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">Team Insights</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Previous insight"
            className="px-1 text-sm font-semibold text-slate-400 transition-colors hover:text-blue-600 disabled:opacity-40"
            disabled={count <= 1}
            onClick={() => go(safeIndex - 1)}
          >
            &lt;
          </button>
          <div className="flex items-center gap-1.5" aria-label="Insight slide indicators">
            {slides.map((item, i) => (
              <button
                key={item.id}
                type="button"
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === safeIndex ? "true" : undefined}
                className={cn(
                  "text-[10px] leading-none transition-colors",
                  i === safeIndex ? "text-blue-600" : "text-slate-300 hover:text-slate-400",
                )}
                onClick={() => go(i)}
              >
                {i === safeIndex ? "●" : "○"}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Next insight"
            className="px-1 text-sm font-semibold text-slate-400 transition-colors hover:text-blue-600 disabled:opacity-40"
            disabled={count <= 1}
            onClick={() => go(safeIndex + 1)}
          >
            &gt;
          </button>
        </div>
      </div>

      {slide ? (
        <div className="flex w-full min-h-[140px] items-start space-x-6 p-4">
          {slide.player ? (
            <button
              type="button"
              aria-label={`Open ${slide.player.name} details`}
              className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-full border border-slate-100 bg-slate-50 transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              onClick={() => modalRef.current?.open(slide.player!.id)}
            >
              <PlayerAvatar
                id={slide.player.id}
                pos={slide.player.pos}
                team={slide.player.team}
                name={slide.player.name}
                className="size-20"
                logoClassName="size-5"
              />
            </button>
          ) : (
            <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-full border border-slate-100 bg-slate-50 text-xs font-bold text-slate-400">
              TLO
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              {slide.tag}
            </p>
            <p className="mb-2 text-base font-black text-slate-900">{slide.headline}</p>
            <p className="text-xs leading-relaxed text-slate-600">{slide.body}</p>
            <Link
              to={slide.action.to}
              className="mt-3 inline-block text-xs font-semibold text-primary hover:underline"
            >
              {slide.action.label}
            </Link>
          </div>
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

function MatchupPreviewCard({
  week,
  loading,
  leagueId,
  platform,
  myName,
  myLogo,
  myLive,
  myProj,
  myWinPct,
  oppName,
  oppLogo,
  oppLive,
  oppProj,
  oppWinPct,
}: {
  week: number;
  loading: boolean;
  leagueId?: string | null;
  platform?: string | null;
  myName: string;
  myLogo?: string | null;
  myLive: number;
  /** 3-tier live rolling projection (pre / in-progress / finished). */
  myProj: number;
  /** Win probability from live rolling team totals (0–100). */
  myWinPct: number;
  oppName: string;
  oppLogo?: string | null;
  oppLive: number;
  /** 3-tier live rolling projection (pre / in-progress / finished). */
  oppProj: number;
  /** Win probability from live rolling team totals (0–100). */
  oppWinPct: number;
}) {
  const mineLeadsProj = myProj >= oppProj;
  const mineLeadsWin = myWinPct >= oppWinPct;
  const mineBarClass = mineLeadsWin ? "bg-emerald-500" : "bg-rose-500";
  const oppBarClass = mineLeadsWin ? "bg-rose-500" : "bg-emerald-500";
  const minePctClass = mineLeadsWin ? "text-emerald-600" : "text-rose-600";
  const oppPctClass = mineLeadsWin ? "text-rose-600" : "text-emerald-600";
  const avatarLeagueKey = leagueId ?? "none";

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading matchup preview…</p>;
  }

  return (
    <div key={avatarLeagueKey}>
      <div className="flex flex-col items-center justify-between gap-5 px-4 py-6 sm:flex-row sm:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:max-w-[42%]">
          <MatchupTeamAvatar
            name={myName}
            logo={myLogo ?? null}
            platform={platform ?? null}
            cacheKey={`${avatarLeagueKey}-mine`}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-800">{myName}</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums tracking-tight text-slate-900">
              {myLive.toFixed(2)}
            </p>
            <p
              className={cn(
                "text-[11px] tabular-nums",
                mineLeadsProj ? "font-bold text-emerald-600" : "font-medium text-slate-400",
              )}
            >
              {myProj.toFixed(2)}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-2">
          <span className="rounded-lg border border-border bg-slate-50 px-3 py-0.5 text-[11px] font-bold text-slate-600">
            Week {week}
          </span>
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-extrabold uppercase text-white">
            vs
          </span>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-3 sm:max-w-[42%]">
          <div className="min-w-0 text-right">
            <p className="truncate text-sm font-semibold text-slate-800">{oppName}</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums tracking-tight text-slate-900">
              {oppLive.toFixed(2)}
            </p>
            <p
              className={cn(
                "text-[11px] tabular-nums",
                !mineLeadsProj ? "font-bold text-emerald-600" : "font-medium text-slate-400",
              )}
            >
              {oppProj.toFixed(2)}
            </p>
          </div>
          <MatchupTeamAvatar
            name={oppName}
            logo={oppLogo ?? null}
            platform={platform ?? null}
            cacheKey={`${avatarLeagueKey}-opp`}
          />
        </div>
      </div>

      <div className="mt-4 flex w-full items-center gap-3 text-xs font-bold">
        <span className={cn("w-10 shrink-0 tabular-nums", minePctClass)}>{myWinPct}%</span>
        <div className="flex h-1.5 min-w-0 flex-1 items-center gap-1.5">
          <div className="flex h-full min-w-0 flex-1 justify-end overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn("h-full rounded-full transition-[width] duration-500", mineBarClass)}
              style={{ width: `${myWinPct}%` }}
            />
          </div>
          <div className="flex h-full min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn("h-full rounded-full transition-[width] duration-500", oppBarClass)}
              style={{ width: `${oppWinPct}%` }}
            />
          </div>
        </div>
        <span className={cn("w-10 shrink-0 text-right tabular-nums", oppPctClass)}>{oppWinPct}%</span>
      </div>
    </div>
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

  const currentWeek = nflWeek.data ?? null;
  const { matchups, loading: matchupsLoading } = useActiveMatchups(currentWeek);
  const { progressByNflTeam } = useNflGameProgress(currentWeek);
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const sleeperTrending = useQuery({
    queryKey: ["sleeper-trending-add"],
    staleTime: 15 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const res = await fetch(
        "https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=50",
        { headers: { accept: "application/json" } },
      ).catch(() => null);
      if (!res || !res.ok) return [] as { player_id: string; count: number }[];
      const json = (await res.json()) as { player_id?: string; count?: number }[];
      return (Array.isArray(json) ? json : [])
        .map((row) => ({
          player_id: String(row?.player_id ?? ""),
          count: Number(row?.count ?? 0) || 0,
        }))
        .filter((row) => row.player_id);
    },
  });

  const fantasyCalcMarket = useQuery({
    queryKey: ["fantasycalc-current-values-v2", players.length],
    staleTime: 30 * 60 * 1000,
    retry: 1,
    enabled: players.length > 0,
    queryFn: () =>
      loadFantasyCalcMarketMap(
        players.map((p) => ({
          id: p.id,
          name: p.name,
          seasonProj: p.proj?.half ?? p.proj?.ppr ?? p.proj?.std ?? 0,
          weekly: projectFor(p.id) ?? weeklyFallback(p),
          value: brain?.[p.id]?.value ?? null,
          trend: brain?.[p.id]?.trend ?? null,
        })),
      ),
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
      myPlayerPoints: {} as Record<string, number>,
      oppStarterIds: [] as string[],
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
      myPlayerPoints: mine.playerPoints ?? {},
      oppStarterIds: rival?.starters ?? [],
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

  /** 3-tier starter rolling totals + smoothed win% from those team sums. */
  const displayMatchup = useMemo(() => {
    const resolveStarters = (ids: string[], fallback: (Player | null)[]): Player[] => {
      if (ids.length) {
        const resolved = ids
          .map((id) => playersById.get(id))
          .filter((p): p is Player => Boolean(p));
        if (resolved.length) return resolved;
      }
      return fallback.filter((p): p is Player => Boolean(p));
    };

    const mineStarters = resolveStarters(weeklyPair.myStarterIds, myTeam?.starters ?? []);
    const oppStarters = resolveStarters(weeklyPair.oppStarterIds, oppTeam?.starters ?? []);

    const myProj = computeTeamDisplayProjection({
      starters: mineStarters,
      playerPoints: weeklyPair.myPlayerPoints,
      projectFor,
      weeklyFallback,
      progressByNflTeam,
      teamLivePoints: weeklyPair.myPoints,
      teamBaselineProj: weeklyPair.myBaseline,
    });
    const oppProj = computeTeamDisplayProjection({
      starters: oppStarters,
      playerPoints: weeklyPair.oppPlayerPoints,
      projectFor,
      weeklyFallback,
      progressByNflTeam,
      teamLivePoints: weeklyPair.oppPoints,
      teamBaselineProj: weeklyPair.oppBaseline,
    });
    const myWinPct = winPctFromDisplayProjections(myProj, oppProj);

    return {
      myProj,
      oppProj,
      myWinPct,
      oppWinPct: 100 - myWinPct,
    };
  }, [weeklyPair, myTeam, oppTeam, playersById, projectFor, progressByNflTeam]);

  const newsEvents = useMemo(() => events.slice(0, 5), [events]);

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
    });
  }, [myTeam, oppTeam, progressByNflTeam, brain]);

  const startSitAlerts = useMemo(() => {
    if (!myTeam) {
      return [] as {
        id: string;
        start: Player;
        sit: Player;
        startPts: number;
        sitPts: number;
      }[];
    }
    const starters = myTeam.starters.filter((p): p is Player => Boolean(p));
    const starterIds = new Set(starters.map((p) => p.id));
    const bench = (myTeam.bench ?? []).filter((p) => !starterIds.has(p.id));
    const alerts: {
      id: string;
      start: Player;
      sit: Player;
      startPts: number;
      sitPts: number;
    }[] = [];

    for (const benchPlayer of bench) {
      const benchPts = projectFor(benchPlayer.id) ?? weeklyFallback(benchPlayer);
      const samePosStarters = starters.filter((s) => s.pos === benchPlayer.pos);
      const weakest =
        samePosStarters.length > 0
          ? samePosStarters
              .map((s) => ({
                player: s,
                pts: projectFor(s.id) ?? weeklyFallback(s),
              }))
              .sort((a, b) => a.pts - b.pts)[0]
          : starters
              .map((s) => ({
                player: s,
                pts: projectFor(s.id) ?? weeklyFallback(s),
              }))
              .sort((a, b) => a.pts - b.pts)[0];

      if (weakest && benchPts > weakest.pts + 0.8) {
        alerts.push({
          id: `${benchPlayer.id}-${weakest.player.id}`,
          start: benchPlayer,
          sit: weakest.player,
          startPts: benchPts,
          sitPts: weakest.pts,
        });
      }
    }

    return alerts.slice(0, 4);
  }, [myTeam, projectFor]);

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
        const fit = toFit(p);
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
          addProj: row.addProj,
          dropProj: row.dropProj,
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
  const [rankBaseline, setRankBaseline] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    setRankBaseline(resolvePowerRankDisplayBaseline(leagueCacheKey, powerRows));
  }, [leagueCacheKey, powerRows]);

  return (
    <div>
      <header className="mb-1">
        <h1 className="display-title text-3xl uppercase tracking-wide">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {activeLeague?.name?.trim() || "Active league"} weekly command view.
        </p>
      </header>

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel
            title="League Activity"
            titleClassName="text-sm font-bold uppercase tracking-wide text-slate-900"
            action={{ to: "/playbook/transactions", label: "Open Transactions" }}
          >
            {activityLoading ? (
              <p className="text-sm text-muted-foreground">Loading league activity…</p>
            ) : (
              <ActivityFeed
                events={newsEvents}
                compact
                emptyMessage="No recent transactions recorded. Summaries will appear here after the next league moves."
              />
            )}
          </Panel>

          <Panel
            title="Matchup"
            titleClassName="text-sm font-bold normal-case tracking-normal text-slate-800"
            action={{ to: "/playbook/matchup", label: "View Matchup" }}
          >
            <MatchupPreviewCard
              week={currentWeek ?? 1}
              loading={loading}
              leagueId={activeLeague?.id ?? null}
              platform={activeLeague?.platform ?? null}
              myName={myTeam?.team || activeLeague?.teamName || "My Team"}
              myLogo={myTeam?.logo ?? activeLeague?.avatar ?? null}
              myLive={weeklyPair.myPoints}
              myProj={displayMatchup.myProj}
              myWinPct={displayMatchup.myWinPct}
              oppName={
                weeklyPair.oppName ||
                oppTeam?.team ||
                (weeklyPair.oppRosterId == null && matchups?.entries?.length
                  ? "Bye week"
                  : "Opponent")
              }
              oppLogo={weeklyPair.oppLogo || oppTeam?.logo || null}
              oppLive={weeklyPair.oppPoints}
              oppProj={displayMatchup.oppProj}
              oppWinPct={displayMatchup.oppWinPct}
            />
          </Panel>

          <TeamInsightsCarousel slides={insightSlides} resetKey={leagueCacheKey} />
        </div>

        <div className="space-y-6 lg:col-span-1">
          <Panel
            title="Power Rankings"
            titleClassName="text-sm font-bold uppercase tracking-wide text-slate-900"
            action={{ to: "/playbook/rankings", label: "Full Rankings" }}
          >
            {loading && !leaderboard.length ? (
              <p className="text-sm text-muted-foreground">Calculating power index…</p>
            ) : !leaderboard.length ? (
              <p className="text-sm text-muted-foreground">No rankings available yet.</p>
            ) : (
              <div className="w-full">
                <div className="flex w-full items-center space-x-3.5 pb-1">
                  <span className="invisible shrink-0 rounded-md px-2 py-0.5 text-xs font-bold" aria-hidden="true">
                    #1
                  </span>
                  <span className="w-10 shrink-0 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Trend
                  </span>
                  <span className="h-8 w-8 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Team
                  </span>
                  <span className="w-16 shrink-0 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Power Index
                  </span>
                </div>
                <ol className="w-full">
                  {leaderboard.map((row) => {
                    const delta = powerRankMovementDelta(rankBaseline, row.slot, row.rank);
                    const trend = powerRankTrend(delta);
                    return (
                      <li
                        key={`${leagueCacheKey}-${row.slot}`}
                        className={cn(
                          "flex w-full items-center space-x-3.5 py-2.5",
                          myTeam && row.slot === myTeam.slot
                            ? "rounded-md bg-blue-50/80 px-1.5"
                            : undefined,
                        )}
                      >
                        <span className={cn("shrink-0", powerRankBadgeClass(row.rank))}>
                          #{row.rank}
                        </span>
                        <span className={cn("w-10 shrink-0 text-center", trend.className)}>
                          {trend.label}
                        </span>
                        <MatchupTeamAvatar
                          name={row.team}
                          logo={logoBySlot.get(row.slot) ?? null}
                          platform={activeLeague?.platform ?? null}
                          cacheKey={`${leagueCacheKey}-rank-${row.slot}`}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-800">
                            {row.team}
                          </span>
                          <span className="block truncate text-[11px] text-slate-500">
                            {row.owner || "Owner"}
                          </span>
                        </span>
                        <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-700">
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
            titleClassName="text-sm font-bold uppercase tracking-wide text-slate-900"
            action={{ to: "/playbook/my-team", label: "Review Lineup" }}
          >
            {!startSitAlerts.length ? (
              <p className="text-sm text-muted-foreground">
                No clear bench upgrades detected against current starters.
              </p>
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
            titleClassName="text-sm font-bold uppercase tracking-wide text-slate-900"
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
                          {target.dropProj.toFixed(1)} Proj
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
        </div>
      </div>

      <PlayerModalHost ref={modalRef} />
    </div>
  );
}
