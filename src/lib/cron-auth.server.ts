/**
 * Auth gate for Vercel Cron / manual ops triggers.
 * Accepts Vercel's cron header or `Authorization: Bearer $CRON_SECRET`.
 */
export function authorizeCronRequest(request: Request): boolean {
  const vercelCron = request.headers.get("x-vercel-cron");
  if (vercelCron === "1") return true;

  // Strip wrapping quotes / whitespace — common when pasting into Vercel/GitHub UIs.
  const secret = process.env["CRON_SECRET"]?.trim().replace(/^["']|["']$/g, "");
  if (!secret) {
    // Allow in local/dev when no secret is configured so operators can smoke-test.
    if (process.env["NODE_ENV"] !== "production" && !process.env["VERCEL"]) return true;
    return false;
  }

  const auth = (request.headers.get("authorization") ?? "").trim();
  // Accept raw secret or "Bearer <secret>"; ignore accidental "Bearer Bearer …".
  const token = auth.replace(/^Bearer\s+/i, "").trim().replace(/^["']|["']$/g, "");
  return token.length > 0 && token === secret;
}
