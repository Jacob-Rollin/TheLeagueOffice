/**
 * Relative timestamps for league chat / activity feeds.
 * TiDB/MySQL `UTC_TIMESTAMP()` often returns `"YYYY-MM-DD HH:mm:ss"` without a
 * timezone — browsers then parse it as local time and everything looks like
 * "just now". Always treat bare datetimes as UTC.
 */

/** Parse a server timestamp into epoch ms (UTC for bare MySQL datetimes). */
export function parseServerDateMs(raw: string | number | Date | null | undefined): number {
  if (raw == null) return NaN;
  if (raw instanceof Date) {
    const t = raw.getTime();
    return Number.isFinite(t) ? t : NaN;
  }
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : NaN;
  }
  const s = String(raw).trim();
  if (!s) return NaN;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }
  // Already has timezone / offset.
  if (/[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : NaN;
  }
  // "2026-10-21 17:00:00.123" or "2026-10-21T17:00:00"
  const normalized = s.includes("T") ? s : s.replace(" ", "T");
  const t = Date.parse(`${normalized}Z`);
  return Number.isFinite(t) ? t : NaN;
}

/** Human relative label; clamps future clocks to "just now". */
export function formatRelativeTimeAgo(
  atMs: number,
  nowMs: number = Date.now(),
): string {
  if (!Number.isFinite(atMs)) return "";
  const diff = Math.max(0, nowMs - atMs);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(atMs).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatRelativeTimeAgoFromRaw(
  raw: string | number | Date | null | undefined,
  nowMs: number = Date.now(),
): string {
  return formatRelativeTimeAgo(parseServerDateMs(raw), nowMs);
}
