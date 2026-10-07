/**
 * Per-tab Sleeper request budget.
 *
 * Sleeper's public ceiling is ~1000 req/min per IP. Each visitor uses their own
 * browser IP — we intentionally lean on that pool so Vercel CDN/Fluid stay lean.
 * Soft-cap per tab still leaves headroom for 2–3 tabs on one household IP and
 * prefers live scoring over warm/prefetch.
 */

type Kind = "live" | "warm" | "default";

const WINDOW_MS = 60_000;
/**
 * Soft ceiling per tab. ~1000/min IP limit; 180 leaves room for ~5 busy tabs
 * before approaching the ceiling, while allowing history warm + live polls.
 */
const SOFT_LIMIT_PER_MIN = 180;
/** Reserved slots so live matchup polls are not starved by warm/prefetch. */
const LIVE_RESERVE = 36;

const stamps: number[] = [];

function prune(now: number) {
  while (stamps.length && now - stamps[0]! >= WINDOW_MS) stamps.shift();
}

export function sleeperBudgetUsed(): number {
  prune(Date.now());
  return stamps.length;
}

export function sleeperBudgetRemaining(kind: Kind = "default"): number {
  prune(Date.now());
  const used = stamps.length;
  if (kind === "live") return Math.max(0, SOFT_LIMIT_PER_MIN - used);
  // Non-live traffic may not eat the live reserve.
  const nonLiveCap = Math.max(0, SOFT_LIMIT_PER_MIN - LIVE_RESERVE);
  const nonLiveUsed = Math.max(0, used); // approximate; live stamps count too
  return Math.max(0, nonLiveCap - Math.min(nonLiveUsed, nonLiveCap));
}

/**
 * Record one outbound Sleeper call. Returns false when the tab should skip
 * / delay the call to avoid approaching the IP rate limit.
 */
export function acquireSleeperPermit(kind: Kind = "default"): boolean {
  const now = Date.now();
  prune(now);
  const used = stamps.length;

  if (kind === "live") {
    if (used >= SOFT_LIMIT_PER_MIN) return false;
    stamps.push(now);
    return true;
  }

  // Keep LIVE_RESERVE free for scoring polls.
  if (used >= SOFT_LIMIT_PER_MIN - LIVE_RESERVE) return false;
  stamps.push(now);
  return true;
}

/** Wait until a permit is available or timeout. */
export async function waitForSleeperPermit(
  kind: Kind = "default",
  timeoutMs = 5_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (acquireSleeperPermit(kind)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
