import type { Player } from "@/lib/players-build";

export type NflGameProgress = {
  /** Regulation minutes still on the game clock (0–60). */
  minutesRemaining: number;
  phase: "pre" | "in" | "post";
  /** ESPN display clock while in progress (e.g. "12:44"). */
  displayClock?: string;
  /** 1–4 regulation quarters; 5+ is overtime. */
  period?: number;
  /** ISO kickoff timestamp for pre-game schedule labels. */
  kickoffIso?: string;
  /** ESPN short status detail fallback. */
  shortDetail?: string;
  /** Uppercase NFL team abbreviation currently with possession, when known. */
  possessionAbbr?: string;
  /** Final / live box score label, e.g. "SEA 13 - NE 10". */
  boxScoreLabel?: string;
  /** Uppercase NFL opponent abbreviation for this team's game, when known. */
  opponentAbbr?: string;
  /** Outdoor weather condition label from the scoreboard, when present. */
  weather?: string | null;
  /** True when the venue is indoor / domed / roofed. */
  indoor?: boolean;
};

const QUARTER_MINUTES = 15;
const REGULATION_MINUTES = 60;

function parseClockToMinutes(clock: string | undefined): number {
  if (!clock) return 0;
  const parts = clock.split(":").map((p) => Number(p));
  if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
    return Math.max(0, (parts[0] ?? 0) + (parts[1] ?? 0) / 60);
  }
  return 0;
}

/**
 * Build NFL-team → game-progress map from an ESPN scoreboard payload.
 * Keys are uppercase abbreviations (e.g. KC, SF).
 */
export function buildNflGameProgressMap(scoreboard: unknown): Map<string, NflGameProgress> {
  const map = new Map<string, NflGameProgress>();
  const events = (scoreboard as { events?: unknown[] } | null)?.events;
  if (!Array.isArray(events)) return map;

  for (const event of events) {
    const ev = event as {
      date?: string;
      competitions?: unknown[];
      status?: { type?: { shortDetail?: string } };
    };
    const competition = ev?.competitions?.[0] as
      | {
          date?: string;
          status?: {
            type?: { state?: string; name?: string; shortDetail?: string };
            period?: number;
            displayClock?: string;
            clock?: number;
          };
          situation?: { possession?: string };
          competitors?: {
            id?: string;
            homeAway?: string;
            score?: string | number;
            team?: { abbreviation?: string };
          }[];
          weather?: {
            displayValue?: string;
            conditionId?: string | number;
            temperature?: number;
          } | null;
          venue?: {
            indoor?: boolean;
            roofType?: string;
            fullName?: string;
          } | null;
        }
      | undefined;
    if (!competition) continue;

    const state = String(competition.status?.type?.state ?? "pre").toLowerCase();
    const typeName = String(competition.status?.type?.name ?? "").toLowerCase();
    const phase: NflGameProgress["phase"] =
      state === "post" || typeName.includes("final")
        ? "post"
        : state === "in" || state === "halftime" || typeName.includes("half")
          ? "in"
          : "pre";

    const period = Math.max(1, Number(competition.status?.period ?? 1) || 1);
    const displayClock = String(competition.status?.displayClock ?? "").trim() || undefined;
    const kickoffIso = String(ev?.date ?? competition.date ?? "").trim() || undefined;
    const shortDetail =
      String(
        competition.status?.type?.shortDetail ?? ev?.status?.type?.shortDetail ?? "",
      ).trim() || undefined;

    const weatherRaw = String(competition.weather?.displayValue ?? "").trim();
    const weather = weatherRaw || null;
    const roofType = String(competition.venue?.roofType ?? "").toLowerCase();
    const indoor = Boolean(
      competition.venue?.indoor ||
        roofType.includes("dome") ||
        roofType.includes("retractable") ||
        roofType.includes("indoor") ||
        roofType.includes("closed"),
    );

    const possessionId = competition.situation?.possession;
    let possessionAbbr: string | undefined;
    if (possessionId != null) {
      const holder = (competition.competitors ?? []).find(
        (c) => String(c?.id ?? "") === String(possessionId),
      );
      possessionAbbr = holder?.team?.abbreviation?.trim().toUpperCase() || undefined;
    }

    const away = (competition.competitors ?? []).find((c) => c.homeAway === "away");
    const home = (competition.competitors ?? []).find((c) => c.homeAway === "home");
    const awayAbbr = away?.team?.abbreviation?.trim().toUpperCase() ?? "";
    const homeAbbr = home?.team?.abbreviation?.trim().toUpperCase() ?? "";
    const awayScore = String(away?.score ?? "").trim();
    const homeScore = String(home?.score ?? "").trim();
    const boxScoreLabel =
      awayAbbr && homeAbbr && awayScore !== "" && homeScore !== ""
        ? `${awayAbbr} ${awayScore} - ${homeAbbr} ${homeScore}`
        : undefined;

    let minutesRemaining = REGULATION_MINUTES;
    if (phase === "post") {
      minutesRemaining = 0;
    } else if (phase === "in") {
      const clockMin =
        typeof competition.status?.clock === "number"
          ? Math.max(0, competition.status.clock / 60)
          : parseClockToMinutes(competition.status?.displayClock);

      if (period > 4) {
        minutesRemaining = Math.min(QUARTER_MINUTES, clockMin);
      } else {
        minutesRemaining = Math.max(
          0,
          Math.min(REGULATION_MINUTES, (4 - period) * QUARTER_MINUTES + clockMin),
        );
      }
    }

    const progressBase: NflGameProgress = {
      minutesRemaining,
      phase,
      period,
      indoor,
      weather,
      ...(displayClock ? { displayClock } : {}),
      ...(kickoffIso ? { kickoffIso } : {}),
      ...(shortDetail ? { shortDetail } : {}),
      ...(possessionAbbr ? { possessionAbbr } : {}),
      ...(boxScoreLabel ? { boxScoreLabel } : {}),
    };

    for (const competitor of competition.competitors ?? []) {
      const abbr = competitor.team?.abbreviation?.trim().toUpperCase();
      if (!abbr) continue;
      const opponentAbbr =
        abbr === awayAbbr ? homeAbbr : abbr === homeAbbr ? awayAbbr : "";
      map.set(abbr, {
        ...progressBase,
        ...(opponentAbbr ? { opponentAbbr } : {}),
      });
    }
  }

  return map;
}

/** @deprecated Alias kept for older imports. */
export const buildNflRemainFracMap = buildNflGameProgressMap;

/**
 * 3-tier player lifecycle for live matchup math:
 * - Phase 1 (pre): 100% baseline
 * - Phase 2 (in): livePoints + baseline * (minutesRemaining / 60)
 * - Phase 3 (post): lock live/final points only
 */
export function playerLiveRollingProjection(opts: {
  livePoints: number;
  baselineProjection: number;
  progress: NflGameProgress | undefined;
}): number {
  const live = Math.max(0, Number(opts.livePoints) || 0);
  const baseline = Math.max(0, Number(opts.baselineProjection) || 0);
  const progress = opts.progress;

  if (!progress || progress.phase === "pre") {
    // Not kicked off yet — keep full pre-game baseline (even if live is 0).
    // If we've somehow scored without scoreboard context, lock actuals.
    if (!progress && live > 0) return live;
    return baseline;
  }

  if (progress.phase === "post") {
    return live;
  }

  // In progress: preserve remaining upside via clock share of baseline.
  const remainFrac = Math.max(0, Math.min(1, progress.minutesRemaining / REGULATION_MINUTES));
  return live + baseline * remainFrac;
}

/**
 * Team display projection = sum of 3-tier starter rolling totals.
 */
export function computeTeamDisplayProjection(opts: {
  starters: Player[];
  playerPoints: Record<string, number>;
  projectFor: (playerId: string) => number | null;
  weeklyFallback: (player: Player) => number;
  progressByNflTeam: Map<string, NflGameProgress>;
  teamLivePoints?: number;
  teamBaselineProj?: number;
}): number {
  const {
    starters,
    playerPoints,
    projectFor,
    weeklyFallback,
    progressByNflTeam,
    teamLivePoints = 0,
    teamBaselineProj = 0,
  } = opts;

  if (!starters.length) {
    const samples = [...progressByNflTeam.values()];
    if (!samples.length) {
      return teamLivePoints > 0 ? round2(teamLivePoints) : round2(teamBaselineProj);
    }
    const allPost = samples.every((s) => s.phase === "post");
    if (allPost) return round2(teamLivePoints);
    const allPre = samples.every((s) => s.phase === "pre");
    if (allPre) return round2(teamBaselineProj);
    const avgMinutes =
      samples.reduce((sum, s) => sum + s.minutesRemaining, 0) / Math.max(1, samples.length);
    return round2(
      Math.max(0, teamLivePoints) +
        Math.max(0, teamBaselineProj) * Math.max(0, Math.min(1, avgMinutes / REGULATION_MINUTES)),
    );
  }

  let total = 0;
  for (const player of starters) {
    const nfl = (player.team || "").trim().toUpperCase();
    const progress = progressByNflTeam.get(nfl);
    const livePoints = Number(playerPoints[player.id] ?? 0) || 0;
    const baseline = projectFor(player.id) ?? weeklyFallback(player);
    total += playerLiveRollingProjection({ livePoints, baselineProjection: baseline, progress });
  }

  return round2(total);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Win% from display projections:
 * raw = mine / (mine + opp), then amplify deviation from 50/50 so modest
 * projection gaps (e.g. 112.08 vs 120.82) read as board-style 42% / 58%.
 */
export function winPctFromDisplayProjections(mine: number, opp: number): number {
  const a = Math.max(0, Number(mine) || 0);
  const b = Math.max(0, Number(opp) || 0);
  const total = a + b;
  if (total <= 0) return 50;

  const raw = a / total;
  const SMOOTHING = 4.25;
  const adjusted = 0.5 + (raw - 0.5) * SMOOTHING;
  return Math.round(Math.min(99, Math.max(1, adjusted * 100)));
}

/** Compact local kickoff label, e.g. "Sun 3:25PM". */
export function formatNflKickoffLabel(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString(undefined, { weekday: "short" });
  const time = d
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .replace(/\s+(AM|PM)/i, (_, m: string) => m.toUpperCase());
  return `${day} ${time}`;
}

/**
 * Live schedule / clock label for a player's NFL team on the scoreboard.
 * Pre → kickoff time, in → "3Q 12:44", post → "final".
 */
export function formatNflGameStatusLabel(
  progress: NflGameProgress | undefined,
  _teamAbbr?: string | null,
): string {
  if (!progress) return "";
  if (progress.phase === "post") return "final";
  if (progress.phase === "in") {
    const period = Math.max(1, Number(progress.period ?? 1) || 1);
    const q = period > 4 ? "OT" : `${period}Q`;
    const clock = (progress.displayClock ?? "").trim();
    return clock ? `${q} ${clock}` : q;
  }
  return formatNflKickoffLabel(progress.kickoffIso) || progress.shortDetail || "";
}
