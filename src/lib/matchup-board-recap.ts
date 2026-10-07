/**
 * Client-only matchup board recap + story timeline.
 * Built from lineup / points / projections already on the matchup page — no APIs.
 */

export type BoardRecapPlayer = {
  id: string;
  name: string;
  pos: string;
  team: string;
  points: number;
  projected: number | null;
};

export type BoardRecapSide = {
  name: string;
  record: string | null;
  logo: string | null;
  finalScore: number;
  projectedScore: number;
  /** Aligned with `slots` by index. */
  starters: (BoardRecapPlayer | null)[];
  bench: BoardRecapPlayer[];
};

export type MatchupBoardRecapInput = {
  week: number;
  slots: string[];
  left: BoardRecapSide;
  right: BoardRecapSide;
};

export type BoardBattle = {
  slot: string;
  left: BoardRecapPlayer | null;
  right: BoardRecapPlayer | null;
  leftPts: number;
  rightPts: number;
  winner: "left" | "right" | "tie";
};

export type BoardPerformer = {
  side: "left" | "right";
  player: BoardRecapPlayer;
  delta: number | null;
};

export type StoryBeatKind = "scorer" | "boom" | "bust" | "lead";

export type StoryBeat = {
  /** Chart X 0–100. */
  t: number;
  kind: StoryBeatKind;
  side: "left" | "right";
  player: BoardRecapPlayer;
  headline: string;
  /** Score totals to show when this beat fires (interpolated race). */
  scoreLeft: number;
  scoreRight: number;
};

export type StoryAxisTick = { t: number; label: string };

export type StoryPoint = {
  t: number;
  label: string;
  scoreLeft: number;
  scoreRight: number;
  winPctLeft: number;
  winPctRight: number;
};

export type MatchupStoryTimeline = {
  axisTicks: StoryAxisTick[];
  points: StoryPoint[];
  beats: StoryBeat[];
};

const AXIS: StoryAxisTick[] = [
  { t: 0, label: "Wed" },
  { t: 12, label: "Thu" },
  { t: 48, label: "Sun" },
  { t: 82, label: "Mon" },
  { t: 100, label: "Final" },
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function shortName(full: string): string {
  const cleaned = full.trim();
  if (!cleaned) return "Player";
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]!.charAt(0)}. ${parts[parts.length - 1]!}`;
}

function winPctFromScores(left: number, right: number, t: number): { a: number; b: number } {
  if (t >= 99.5) {
    if (left > right + 0.005) return { a: 99, b: 1 };
    if (right > left + 0.005) return { a: 1, b: 99 };
    return { a: 50, b: 50 };
  }
  const diff = left - right;
  // Soft logistic so early gaps don't look locked.
  const ease = 0.35 + 0.65 * (t / 100);
  const raw = 50 + (diff / Math.max(8, (left + right) * 0.12 + 6)) * 28 * ease;
  const a = Math.max(8, Math.min(92, round2(raw)));
  return { a, b: round2(100 - a) };
}

export function boardBattles(input: MatchupBoardRecapInput): BoardBattle[] {
  return input.slots.map((slot, i) => {
    const left = input.left.starters[i] ?? null;
    const right = input.right.starters[i] ?? null;
    const leftPts = left?.points ?? 0;
    const rightPts = right?.points ?? 0;
    const winner =
      Math.abs(leftPts - rightPts) < 0.005 ? "tie" : leftPts > rightPts ? "left" : "right";
    return { slot, left, right, leftPts, rightPts, winner };
  });
}

export function boardPerformers(input: MatchupBoardRecapInput): BoardPerformer[] {
  const rows: BoardPerformer[] = [];
  const push = (side: "left" | "right", p: BoardRecapPlayer | null | undefined) => {
    if (!p) return;
    rows.push({
      side,
      player: p,
      delta: p.projected != null ? round2(p.points - p.projected) : null,
    });
  };
  for (const p of input.left.starters) push("left", p);
  for (const p of input.right.starters) push("right", p);
  return rows;
}

export function slotWinCounts(battles: BoardBattle[]): { left: number; right: number } {
  let left = 0;
  let right = 0;
  for (const b of battles) {
    if (b.winner === "left") left += 1;
    if (b.winner === "right") right += 1;
  }
  return { left, right };
}

export function benchPointsLeft(input: MatchupBoardRecapInput): { left: number; right: number } {
  const sum = (rows: BoardRecapPlayer[]) =>
    round2(rows.reduce((acc, p) => acc + (Number(p.points) || 0), 0));
  return { left: sum(input.left.bench), right: sum(input.right.bench) };
}

/**
 * Build a visual Wed→Final score race + story beats from board totals only.
 * Not play-by-play — ordered by fantasy impact for callouts.
 */
export function buildMatchupStoryTimeline(input: MatchupBoardRecapInput): MatchupStoryTimeline {
  const finalL = Math.max(0, Number(input.left.finalScore) || 0);
  const finalR = Math.max(0, Number(input.right.finalScore) || 0);
  const performers = boardPerformers(input);

  const topScorers = [...performers].sort((a, b) => b.player.points - a.player.points).slice(0, 3);
  const boom =
    [...performers]
      .filter((p) => p.delta != null)
      .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))[0] ?? null;
  const bust =
    [...performers]
      .filter((p) => p.delta != null)
      .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))[0] ?? null;

  type Draft = Omit<StoryBeat, "scoreLeft" | "scoreRight">;
  const drafts: Draft[] = [];
  const used = new Set<string>();

  const add = (kind: StoryBeatKind, row: BoardPerformer | null, t: number, headline: string) => {
    if (!row) return;
    const key = `${row.side}:${row.player.id}`;
    if (used.has(key) && kind === "scorer") return;
    used.add(key);
    drafts.push({
      t,
      kind,
      side: row.side,
      player: row.player,
      headline,
    });
  };

  // Space impact moments across Sun-heavy stretch of the axis.
  const scorerTs = [28, 52, 68];
  topScorers.forEach((row, i) => {
    const pts = row.player.points.toFixed(1);
    add("scorer", row, scorerTs[i] ?? 60, `${shortName(row.player.name)} — ${pts} pts`);
  });
  if (boom && (boom.delta ?? 0) >= 3) {
    add(
      "boom",
      boom,
      40,
      `Boom: ${shortName(boom.player.name)} ${boom.delta! >= 0 ? "+" : ""}${boom.delta!.toFixed(1)} vs proj`,
    );
  }
  if (bust && (bust.delta ?? 0) <= -3) {
    add(
      "bust",
      bust,
      74,
      `Bust: ${shortName(bust.player.name)} ${bust.delta!.toFixed(1)} vs proj`,
    );
  }

  drafts.sort((a, b) => a.t - b.t);

  // Score race: ease toward finals; slightly stagger sides so the chart isn't flat.
  const points: StoryPoint[] = [];
  const beats: StoryBeat[] = [];
  const sampleTs = [0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96, 100];
  const ts = [...new Set([...sampleTs, ...drafts.map((d) => d.t)])].sort((a, b) => a - b);

  const leftPace = finalL >= finalR ? 1.06 : 0.94;
  const rightPace = finalR > finalL ? 1.06 : 0.94;

  const scoreAt = (t: number): { left: number; right: number } => {
    if (t >= 99.5) return { left: finalL, right: finalR };
    const u = t / 100;
    const e = u * u * (3 - 2 * u);
    // Asymmetric ease so the eventual winner pulls ahead mid-week on the story chart.
    const leftE = Math.min(1, e * leftPace);
    const rightE = Math.min(1, e * rightPace);
    return { left: round2(finalL * leftE), right: round2(finalR * rightE) };
  };

  for (const t of ts) {
    const { left, right } = scoreAt(t);
    const win = winPctFromScores(left, right, t);
    const tick = AXIS.find((a) => Math.abs(a.t - t) < 0.5);
    points.push({
      t,
      label: tick?.label ?? (t >= 99.5 ? "Final" : ""),
      scoreLeft: left,
      scoreRight: right,
      winPctLeft: win.a,
      winPctRight: win.b,
    });
  }

  for (const d of drafts) {
    const { left, right } = scoreAt(d.t);
    beats.push({ ...d, scoreLeft: left, scoreRight: right });
  }

  // Lead-change beat if sides flip mid-race.
  let prevLead: "left" | "right" | null = null;
  for (const p of points) {
    if (p.t < 20 || p.t > 90) continue;
    if (Math.abs(p.scoreLeft - p.scoreRight) < 0.5) continue;
    const lead: "left" | "right" = p.scoreLeft > p.scoreRight ? "left" : "right";
    if (prevLead != null && lead !== prevLead) {
      const top = performers
        .filter((r) => r.side === lead)
        .sort((a, b) => b.player.points - a.player.points)[0];
      if (top && !beats.some((b) => Math.abs(b.t - p.t) < 4)) {
        beats.push({
          t: p.t,
          kind: "lead",
          side: lead,
          player: top.player,
          headline: `${lead === "left" ? input.left.name : input.right.name} takes the lead`,
          scoreLeft: p.scoreLeft,
          scoreRight: p.scoreRight,
        });
      }
      break;
    }
    prevLead = lead;
  }

  beats.sort((a, b) => a.t - b.t);

  return { axisTicks: AXIS, points, beats };
}

export function boardRecapHeadline(input: MatchupBoardRecapInput): string {
  const left = input.left.finalScore;
  const right = input.right.finalScore;
  if (Math.abs(left - right) <= 0.005) return "It ended in a tie";
  if (left > right) return `${input.left.name} got the W`;
  return `${input.right.name} got the W`;
}

export { shortName as boardShortName };
