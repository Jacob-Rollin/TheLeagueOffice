/**
 * Auth gate for Vercel Cron / manual ops triggers.
 * Accepts Vercel's cron header or `Authorization: Bearer $CRON_SECRET`.
 */
export function authorizeCronRequest(request: Request): boolean {
  const vercelCron = request.headers.get("x-vercel-cron");
  if (vercelCron === "1") return true;

  const secret = process.env["CRON_SECRET"]?.trim();
  if (!secret) {
    // Allow in local/dev when no secret is configured so operators can smoke-test.
    if (process.env["NODE_ENV"] !== "production" && !process.env["VERCEL"]) return true;
    return false;
  }

  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}
