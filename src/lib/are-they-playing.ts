/** "Healthy" = the club filed that day's report without the player on it. */
export type PracticeMark = "DNP" | "LP" | "FP" | "Healthy";
export type GameStatus = "Out" | "Doubtful" | "Questionable";

export type PracticeDay = { day: string; mark: PracticeMark | null };

/** One player line from a club's official weekly injury report. */
export type InjuryReportLine = {
  name: string;
  team: string;
  pos: string;
  injury: string | null;
  days: PracticeDay[];
  /** Official game designation; null when not designated (or not yet published). */
  gameStatus: GameStatus | null;
  /** Club has published its final report of the week (designations are set). */
  final: boolean;
};

export type AreTheyPlayingPayload = {
  week: number;
  updatedAt: number;
  lines: InjuryReportLine[];
};

/**
 * Share of players who took a snap, by final game status and final practice level,
 * from 2023-2025 regular-season official reports (nflverse injuries + snap counts),
 * scaled up for the ~6% of active players the name join misses.
 */
const FINAL_RATES: Record<GameStatus | "None", Record<PracticeMark | "None", number>> = {
  Out: { DNP: 0, LP: 0, FP: 0, Healthy: 0, None: 0 },
  Doubtful: { DNP: 2, LP: 2, FP: 2, Healthy: 2, None: 2 },
  Questionable: { DNP: 50, LP: 65, FP: 77, Healthy: 77, None: 77 },
  None: { DNP: 76, LP: 99, FP: 99, Healthy: 99, None: 99 },
};

/** Midweek, before designations: play rate by latest practice level. */
const MIDWEEK_RATES: Record<PracticeMark, number> = { DNP: 52, LP: 73, FP: 96, Healthy: 99 };

const MARK_ORDER: Record<PracticeMark, number> = { DNP: 0, LP: 1, FP: 2, Healthy: 2 };

export function normPlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z]/g, "");
}

/** Maps a Sleeper/ESPN injury token to a game designation (IR, PUP, suspended count as Out). */
export function designationFromStatus(status: string | null | undefined): GameStatus | null {
  const v = (status ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v === "questionable" || v === "q") return "Questionable";
  if (v === "doubtful" || v === "d") return "Doubtful";
  if (
    v === "out" ||
    v === "o" ||
    v === "ir" ||
    v.includes("injured reserve") ||
    v.startsWith("pup") ||
    v === "na" ||
    v.includes("suspend") ||
    v === "nfi"
  ) {
    return "Out";
  }
  return null;
}

export function latestMark(days: PracticeDay[]): PracticeMark | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const mark = days[i]?.mark;
    if (mark) return mark;
  }
  return null;
}

/** Chance (0-99) the player suits up this week; null when there's nothing to grade yet. */
export function chanceToPlay(line: InjuryReportLine): number | null {
  const last = latestMark(line.days);
  const nir = /not injury related|\bNIR\b/i.test(line.injury ?? "");

  if (line.final || line.gameStatus) {
    const rate = FINAL_RATES[line.gameStatus ?? "None"][last ?? "None"];
    return nir && line.gameStatus !== "Out" && line.gameStatus !== "Doubtful" ? Math.max(rate, 95) : rate;
  }

  if (!last) return null;
  const marks = line.days.map((d) => d.mark).filter((m): m is PracticeMark => m != null);
  let rate = MIDWEEK_RATES[last];
  if (marks.length >= 2) {
    const prev = marks[marks.length - 2]!;
    if (MARK_ORDER[last] > MARK_ORDER[prev]) rate += 5;
    else if (MARK_ORDER[last] < MARK_ORDER[prev]) rate -= 10;
  }
  if (nir) rate = Math.max(rate, 90);
  return Math.max(1, Math.min(99, rate));
}

/** "Wed (LP), Thu (FP), Fri (FP)" — skips days that haven't been reported. */
export function practiceSummary(days: PracticeDay[]): string {
  return days
    .filter((d) => d.mark)
    .map((d) => `${d.day} (${d.mark})`)
    .join(", ");
}
