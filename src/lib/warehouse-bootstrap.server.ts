/**
 * Warehouse bootstrap / scheduled ingest.
 *
 * Prefer the Vercel cron at `/api/cron/warehouse-ingest` over request-path
 * triggers so Fluid Active CPU is not spent on every SSR hit.
 *
 * When DATABASE_URL (TiDB) is set, cron always refreshes the warehouse.
 * Legacy Supabase brain skip only applies when TiDB is not configured.
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
  if (!url) return true;
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

export async function runScheduledWarehouseIngest(opts?: {
  force?: boolean;
}): Promise<WarehouseIngestReport> {
  const force = Boolean(opts?.force);
  try {
    const { tidbConfigured } = await import("@/lib/tidb");
    const usingTidb = tidbConfigured();

    // TiDB path: always refresh on cron (daily cadence is cheap with batch upserts).
    // Legacy brain path: skip when the storage object already exists unless forced.
    if (!force && !usingTidb && (await brainExists())) {
      return { ok: true, skipped: true, reason: "brain-present" };
    }

    const { runWarehouseIngestion } = await import("./aggregation.server");
    const report = await runWarehouseIngestion();
    console.info(
      `[warehouse-ingest] ok=${report.ok} compiled=${report.compiled} bytes=${report.bytes} tidb=${usingTidb}`,
    );
    return {
      ok: Boolean(report.ok),
      skipped: false,
      compiled: report.compiled,
      bytes: report.bytes,
      ...(report.error ? { reason: report.error } : {}),
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
