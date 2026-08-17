import type { Player, Scoring } from "./draft";

/** Trade-value curve derived from overall rank + season projection. */
export function playerValue(p: Player, scoring: Scoring = "half"): number {
  const rank = p.rank?.[scoring] ?? 999;
  const curve = 1000 * Math.exp(-(Math.max(1, rank) - 1) / 42);
  const proj = p.proj?.[scoring] ?? 0;
  const posFactor = p.pos === "QB" ? 0.75 : p.pos === "K" || p.pos === "DEF" ? 0.4 : 1;
  const injury = p.injury ? 0.88 : 1;
  return Math.round((curve * 0.75 + proj * 1.6) * posFactor * injury);
}

/** Package value with a star premium: depth is worth less than the best asset. */
export function packageValue(players: Player[], scoring: Scoring = "half"): number {
  const vals = players.map((p) => playerValue(p, scoring)).sort((a, b) => b - a);
  return Math.round(vals.reduce((sum, v, i) => sum + v * Math.pow(0.88, i), 0));
}

export type Grade = { letter: string; tone: "good" | "even" | "bad" };

export function grade(diffPct: number): Grade {
  if (diffPct >= 25) return { letter: "A+", tone: "good" };
  if (diffPct >= 15) return { letter: "A", tone: "good" };
  if (diffPct >= 8) return { letter: "B", tone: "good" };
  if (diffPct >= -8) return { letter: "C", tone: "even" };
  if (diffPct >= -15) return { letter: "D", tone: "bad" };
  return { letter: "F", tone: "bad" };
}

export type TradeResult = {
  give: number;
  get: number;
  diff: number;
  diffPct: number;
  grade: Grade;
  verdict: string;
};

export function evaluateTrade(
  give: Player[],
  get: Player[],
  scoring: Scoring = "half",
): TradeResult {
  const g = packageValue(give, scoring);
  const r = packageValue(get, scoring);
  const base = Math.max(g, r, 1);
  const diff = r - g;
  const diffPct = (diff / base) * 100;
  const letter = grade(diffPct);
  const verdict =
    !give.length || !get.length
      ? "Add players to both sides to grade this trade."
      : diffPct >= 8
        ? "You win this trade — you're getting the better package."
        : diffPct <= -8
          ? "You're giving up more value than you get back."
          : "Fair deal — value is close on both sides.";
  return { give: g, get: r, diff, diffPct, grade: letter, verdict };
}

export type WaiverResult = {
  addValue: number;
  dropValue: number;
  gain: number;
  gainPct: number;
  grade: Grade;
  faabLow: number;
  faabHigh: number;
  verdict: string;
};

/** Waiver claim grade: value gained over the roster spot you're spending. */
export function evaluateWaiver(
  add: Player | null,
  drop: Player | null,
  scoring: Scoring = "half",
): WaiverResult {
  const a = add ? playerValue(add, scoring) : 0;
  const d = drop ? playerValue(drop, scoring) : 0;
  const gain = a - d;
  const gainPct = (gain / Math.max(a, d, 1)) * 100;
  const g = grade(gainPct);
  // FAAB suggestion scaled off the add's standalone value (100 budget).
  const pct = Math.min(60, Math.round((a / 900) * 100));
  const faabLow = add ? Math.max(0, Math.round(pct * 0.5)) : 0;
  const faabHigh = add ? Math.max(1, pct) : 0;
  const verdict = !add
    ? "Pick a player to add."
    : gainPct >= 15
      ? "Strong claim — clear upgrade over the player you're dropping."
      : gainPct >= 0
        ? "Marginal upgrade. Worth a low bid if you have the roster room."
        : "Skip it — you'd be downgrading your roster.";
  return { addValue: a, dropValue: d, gain, gainPct, grade: g, faabLow, faabHigh, verdict };
}
