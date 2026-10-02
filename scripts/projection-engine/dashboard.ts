import type { AccuracyFile, Format, Summary } from "./audit";
import { POSITIONS } from "./config";
import type { TrackKey } from "./types";

export const TRACK_LABEL: Record<TrackKey, string> = {
  engine: "Our Custom API",
  sleeper: "Sleeper App",
  espn: "ESPN Fantasy",
  cbs: "CBS Sports",
  model: "nflverse Model",
  baseline: "Recent-Form Baseline",
};

const FORMAT_LABEL: Record<Format, string> = { std: "Standard", half: "Half PPR", ppr: "Full PPR" };
const MEDALS = ["🥇", "🥈", "🥉"];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function standings(summary: Summary, format: Format): string[] {
  const ranked = (Object.keys(summary[format]) as TrackKey[]).sort(
    (a, b) => summary[format][a].mae - summary[format][b].mae,
  );
  const width = Math.max(...ranked.map((t) => TRACK_LABEL[t].length));
  return ranked.map((t, i) => {
    const place = MEDALS[i] ?? "  ";
    const { mae, bias } = summary[format][t];
    const lean = bias > 0.05 ? `projects ${bias.toFixed(2)} high` : bias < -0.05 ? `projects ${Math.abs(bias).toFixed(2)} low` : "no lean";
    return `${i + 1}. ${place} ${TRACK_LABEL[t].padEnd(width)}  --> MAE: ${mae.toFixed(2)} points off actual (${lean})`;
  });
}

/** Plain-text scoreboard for reading the Gist straight in a browser. */
export function renderDashboard(acc: AccuracyFile): string {
  const weeks = Object.keys(acc.weeks).map(Number).sort((a, b) => a - b);
  const latest = weeks[weeks.length - 1];
  const t = acc.ticker;
  const out: string[] = [
    `# The League Office Projection Accuracy, ${acc.season}`,
    "",
    `Updated ${acc.updatedAt.replace("T", " ").slice(0, 16)} UTC. Weeks graded: ${weeks.join(", ") || "none"}. ${acc.rows.length} player-weeks.`,
    "",
    "```text",
    `🏆 SEASON TICKER (Half PPR): Our Engine: ${plural(t.engineVsSleeper.engine, "Week")} Closer to Reality | Sleeper: ${plural(t.engineVsSleeper.sleeper, "Week")} Closer${t.engineVsSleeper.ties ? ` | Ties: ${t.engineVsSleeper.ties}` : ""}`,
    `   Weeks beating the recent-form baseline: ${(["engine", "sleeper", "espn", "cbs", "model"] as TrackKey[])
      .map((k) => `${TRACK_LABEL[k]} ${t.beatBaseline[k] ?? 0}`)
      .join(" | ")}`,
    "```",
  ];
  if (acc.season_overall) {
    for (const f of ["half", "std", "ppr"] as Format[]) {
      out.push("", `## 📊 Fantasy Forecast Accuracy Standings, ${FORMAT_LABEL[f]} (lower error is better)`, "", "```text", ...standings(acc.season_overall, f), "```");
    }
    out.push("", "## Season MAE by position, Half PPR", "", "```text");
    const tracks = Object.keys(acc.season_overall.half) as TrackKey[];
    out.push(`${"Pos".padEnd(5)}${tracks.map((k) => TRACK_LABEL[k].padStart(22)).join("")}`);
    for (const pos of POSITIONS) {
      const s = acc.season_byPos[pos];
      if (!s) continue;
      out.push(`${pos.padEnd(5)}${tracks.map((k) => s.half[k].mae.toFixed(2).padStart(22)).join("")}`);
    }
    out.push("```");
  }
  if (latest != null) {
    const report = acc.weeks[String(latest)]!;
    out.push("", `## Week ${latest}, Half PPR (${report.players} players)`, "", "```text", ...standings(report.overall, "half"), "```");
  }
  out.push(
    "",
    "Every track is graded on the same players (consensus top QB24, RB48, WR60, TE24, K16, DEF16 that every track projected), using projections frozen at each game's kickoff and scored with identical rules.",
  );
  return `${out.join("\n")}\n`;
}
