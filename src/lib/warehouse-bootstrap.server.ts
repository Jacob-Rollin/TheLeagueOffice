/**
 * One-shot, server-side warehouse bootstrap.
 *
 * Runs `runWarehouseIngestion()` exactly once per deployed server instance,
 * and only when the `master_player_brain.json` asset is actually missing from
 * the Database B public bucket (the HTTP 400/404 state). This keeps outbound
 * bandwidth clamped: no UI trigger exists, and no repeat harvest happens once
 * the file is published.
 *
 * Server-only. Never import from client-reachable component code.
 */

const BUCKET = "player_brain";
const FILE = "master_player_brain.json";

let started = false;

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

/** Fire-and-forget bootstrap; safe to call on every request. */
export function ensureWarehouseBootstrap(): void {
  if (started) return;
  started = true;

  void (async () => {
    try {
      if (await brainExists()) return;
      const { runWarehouseIngestion } = await import("./aggregation.server");
      const report = await runWarehouseIngestion();
      console.info(
        `[warehouse-bootstrap] ok=${report.ok} compiled=${report.compiled} bytes=${report.bytes}`,
      );
    } catch {
      // Silent by design — the client hydration layer has its own fallback.
    }
  })();
}
