/**
 * Warehouse bootstrap / scheduled ingest.
 *
 * Prefer the Vercel cron at `/api/cron/warehouse-ingest` over request-path
 * triggers so Fluid Active CPU is not spent on every SSR hit.
 *
 * Requires `DATABASE_URL` (TiDB). Supabase B / Storage brain is retired.
 *
 * Server-only. Never import from client-reachable component code.
 */

export type WarehouseIngestReport = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  compiled?: number;
  bytes?: number;
};

export async function runScheduledWarehouseIngest(_opts?: {
  force?: boolean;
}): Promise<WarehouseIngestReport> {
  try {
    const { tidbConfigured } = await import("@/lib/tidb");
    if (!tidbConfigured()) {
      return {
        ok: false,
        skipped: true,
        reason: "DATABASE_URL not configured (TiDB required)",
      };
    }

    const { ensureTidbWarehouseSeeded } = await import("@/lib/tidb-migrate.server");
    const boot = await ensureTidbWarehouseSeeded();
    if (boot.migrated) {
      console.info(`[warehouse-ingest] auto-migrate ${boot.detail} count=${boot.count}`);
    } else if (boot.detail) {
      console.warn(`[warehouse-ingest] auto-migrate skipped: ${boot.detail}`);
    }

    const { runWarehouseIngestion } = await import("./aggregation.server");
    const report = await runWarehouseIngestion();
    console.info(
      `[warehouse-ingest] ok=${report.ok} compiled=${report.compiled} bytes=${report.bytes} tidb=true`,
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
