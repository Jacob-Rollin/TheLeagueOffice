import { runAudit } from "./audit";
import { fetchJson } from "./http";
import { runUpdate } from "./update";

/**
 * Usage: tsx scripts/projection-engine/index.ts <update|audit> [--dry-run] [--season=2026] [--week=5] [--now=ISO]
 * Publishing needs GIST_ID and GIST_TOKEN; --dry-run writes to PE_OUT_DIR instead.
 * `audit --week=N` grades only week N; plain `audit` grades every finished locked week.
 */
async function main() {
  const [mode = "update", ...rest] = process.argv.slice(2);
  const flag = (name: string) => rest.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const dryRun = rest.includes("--dry-run");

  const state = await fetchJson<{ season?: string; week?: number; season_type?: string }>(
    "https://api.sleeper.app/v1/state/nfl",
  );
  const season = Number(flag("season") ?? state.data?.season);
  if (!season) throw new Error(`could not determine the season (${state.error ?? "no state"})`);

  if (mode === "audit") {
    // Runs after the regular season too, so Week 18 still gets graded.
    await runAudit({ season, dryRun, ...(flag("week") ? { week: Number(flag("week")) } : {}) });
    return;
  }
  if (mode !== "update") throw new Error(`unknown mode "${mode}"`);

  const week = Number(flag("week") ?? state.data?.week);
  if (!week) throw new Error(`could not determine the week (${state.error ?? "no state"})`);
  if (!flag("week") && state.data?.season_type !== "regular") {
    console.log(`[engine] season type is ${state.data?.season_type}; nothing to do`);
    return;
  }
  if (week > 18) {
    console.log(`[engine] week ${week} is past the regular season; nothing to do`);
    return;
  }
  const now = flag("now") ? Date.parse(flag("now")!) : undefined;
  await runUpdate({ season, week, dryRun, ...(now ? { now } : {}) });
}

main().catch((err) => {
  console.error(`[engine] failed: ${(err as Error).message}`);
  process.exit(1);
});
