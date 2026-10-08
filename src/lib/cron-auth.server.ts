/**
 * Auth gate for Vercel Cron / manual ops triggers.
 * Requires `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends this when
 * CRON_SECRET is set; GitHub Actions workflows use the same secret).
 * Do not trust `x-vercel-cron` alone — that header is spoofable off-Vercel.
 */
export function authorizeCronRequest(request: Request): boolean {
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
