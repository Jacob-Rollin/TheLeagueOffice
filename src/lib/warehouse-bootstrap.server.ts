/**
 * Warehouse bootstrap / scheduled ingest for Database B player_warehouse +
 * master_player_brain.json.
 *
 * Prefer the Vercel cron at `/api/cron/warehouse-ingest` over request-path
 * triggers so Fluid Active CPU is not spent on every SSR hit.
 *
 * Server-only. Never import from client-reachable component code.
 */

const BUCKET = "player_brain";
const FILE = "master_player_brain.json";

function brainUrl(): string | null {
  const raw =
    process.env["VITE_SUPABASE_URL_B"] ??
    (import.meta.env["VITE_SUPABASE_URL_B"] as string | undefined);
  if (!raw) return null;
  const origin = raw.replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, "");
  return `${origin}/storage/v1/object/public/${BUCKET}/${FILE}`;
}

async function brainExists(): Promise<boolean> {
  const url = brainUrl();
  if (!url) return true; // no target configured — do nothing
  try {
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    if (!res.ok) return false;
    const text = await res.text();
    return text.trim().length > 2;
  } catch {
    return false;
  }
}

export type WarehouseIngestReport = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  compiled?: number;
  bytes?: number;
};

/**
 * Cron / ops entry: harvest when brain is missing, or when `force` is set.
 */
async function tidbWarehousePopulated(): Promise<boolean> {
  try {
    const { tidbConfigured, tidbExecute } = await import("@/lib/tidb");
    if (!tidbConfigured()) return false;
    const rows = await tidbExecute<{ c: number }>(
      "SELECT COUNT(*) AS c FROM player_warehouse LIMIT 1",
    );
    return Number(rows[0]?.c ?? 0) > 1000;
  } catch {
    return false;
  }
}

export async function runScheduledWarehouseIngest(opts?: {
  force?: boolean;
}): Promise<WarehouseIngestReport> {
  const force = Boolean(opts?.force);
  try {
    // When TiDB is seeded, skip the legacy brain HEAD/GET on the cron path unless forced.
    if (!force && (await tidbWarehousePopulated())) {
      return { ok: true, skipped: true, reason: "tidb-warehouse-populated" };
    }
    if (!force && (await brainExists())) {
      return { ok: true, skipped: true, reason: "brain-present" };
    }
    const { runWarehouseIngestion } = await import("./aggregation.server");
    const report = await runWarehouseIngestion();
    console.info(
      `[warehouse-ingest] ok=${report.ok} compiled=${report.compiled} bytes=${report.bytes}`,
    );
    return {
      ok: Boolean(report.ok),
      skipped: false,
      compiled: report.compiled,
      bytes: report.bytes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "ingest failed";
    console.error("[warehouse-ingest]", message);
    return { ok: false, skipped: false, reason: message };
  }
}

/** @deprecated Prefer `/api/cron/warehouse-ingest`. Kept for emergency manual calls. */
export function ensureWarehouseBootstrap(): void {
  void runScheduledWarehouseIngest({ force: false });
}
