import { fetchJson } from "./http";
import { runUpdate } from "./update";

/**
 * Usage: tsx scripts/projection-engine/index.ts <update> [--dry-run] [--season=2026] [--week=5]
 * Publishing needs GIST_ID and GIST_TOKEN; --dry-run writes to PE_OUT_DIR instead.
 */
async function main() {
  const [mode = "update", ...rest] = process.argv.slice(2);
  const flag = (name: string) => rest.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const dryRun = rest.includes("--dry-run");

  const state = await fetchJson<{ season?: string; week?: number; season_type?: string }>(
    "https://api.sleeper.app/v1/state/nfl",
  );
  const season = Number(flag("season") ?? state.data?.season);
  const week = Number(flag("week") ?? state.data?.week);
  if (!season || !week) throw new Error(`could not determine season/week (${state.error ?? "no state"})`);
  if (!flag("week") && state.data?.season_type !== "regular") {
    console.log(`[engine] season type is ${state.data?.season_type}; nothing to do`);
    return;
  }
  if (week > 18) {
    console.log(`[engine] week ${week} is past the regular season; nothing to do`);
    return;
  }

  if (mode === "update") await runUpdate({ season, week, dryRun });
  else throw new Error(`unknown mode "${mode}"`);
}

main().catch((err) => {
  console.error(`[engine] failed: ${(err as Error).message}`);
  process.exit(1);
});
