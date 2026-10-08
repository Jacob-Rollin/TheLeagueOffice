/**
 * Client-safe NFL kickoff lock helpers for native leagues.
 * Uses ESPN public scoreboard JSON (same shape as ScoreTicker).
 */

export type NflTeamKickoff = {
  team: string;
  kickoffMs: number;
  state: "pre" | "in" | "post";
};

/** Map NFL team abbrev → kickoff / state from ESPN scoreboard JSON. */
export function parseScoreboardKickoffs(json: unknown): Map<string, NflTeamKickoff> {
  const out = new Map<string, NflTeamKickoff>();
  const events = Array.isArray((json as { events?: unknown })?.events)
    ? ((json as { events: unknown[] }).events)
    : [];
  for (const ev of events) {
    const competition =
      Array.isArray((ev as { competitions?: unknown[] })?.competitions)
        ? (ev as { competitions: unknown[] }).competitions[0]
        : null;
    const stateRaw = String(
      (competition as { status?: { type?: { state?: string } } })?.status?.type?.state ??
        (ev as { status?: { type?: { state?: string } } })?.status?.type?.state ??
        "",
    ).toLowerCase();
    const state: "pre" | "in" | "post" =
      stateRaw === "in" ? "in" : stateRaw === "post" ? "post" : "pre";
    const rawDate =
      (competition as { date?: string })?.date ??
      (ev as { date?: string })?.date ??
      (competition as { startDate?: string })?.startDate ??
      null;
    const kickoffMs = rawDate ? Date.parse(String(rawDate)) : NaN;
    if (!Number.isFinite(kickoffMs)) continue;
    const competitors = Array.isArray(
      (competition as { competitors?: unknown[] })?.competitors,
    )
      ? ((competition as { competitors: unknown[] }).competitors)
      : [];
    for (const c of competitors) {
      const abbr = String(
        (c as { team?: { abbreviation?: string } })?.team?.abbreviation ?? "",
      )
        .trim()
        .toUpperCase();
      if (!abbr) continue;
      out.set(abbr, { team: abbr, kickoffMs, state });
    }
  }
  return out;
}

/** True when the NFL team's game has started (in/post or kickoff time passed). */
export function nflTeamHasLocked(
  team: string | null | undefined,
  kickoffs: Map<string, NflTeamKickoff>,
  now = Date.now(),
): boolean {
  const abbr = String(team ?? "").trim().toUpperCase();
  if (!abbr || abbr === "FA") return false;
  const row = kickoffs.get(abbr);
  if (!row) return false;
  if (row.state === "in" || row.state === "post") return true;
  return row.kickoffMs <= now;
}

/** Earliest kickoff among teams still in pre — used for first_game roster lock. */
export function firstGameKickoffMs(
  kickoffs: Map<string, NflTeamKickoff>,
  now = Date.now(),
): number | null {
  let first: number | null = null;
  for (const row of kickoffs.values()) {
    if (row.state === "in" || row.state === "post") {
      first = first == null ? row.kickoffMs : Math.min(first, row.kickoffMs);
      continue;
    }
    if (row.kickoffMs >= now - 5 * 60 * 1000) {
      first = first == null ? row.kickoffMs : Math.min(first, row.kickoffMs);
    }
  }
  return first;
}

export function firstGameHasStarted(
  kickoffs: Map<string, NflTeamKickoff>,
  now = Date.now(),
): boolean {
  const first = firstGameKickoffMs(kickoffs, now);
  if (first == null) return false;
  for (const row of kickoffs.values()) {
    if (row.state === "in" || row.state === "post") return true;
  }
  return first <= now;
}

/**
 * Whether a lineup slot player is locked under league roster_lock_type.
 * - game_time: lock that player's NFL kickoff
 * - first_game: lock entire lineup once the week's first NFL game starts
 */
export function playerRosterLocked(input: {
  rosterLockType: string;
  playerTeam: string | null | undefined;
  kickoffs: Map<string, NflTeamKickoff>;
  now?: number;
}): boolean {
  const now = input.now ?? Date.now();
  if (input.rosterLockType === "first_game") {
    return firstGameHasStarted(input.kickoffs, now);
  }
  return nflTeamHasLocked(input.playerTeam, input.kickoffs, now);
}
