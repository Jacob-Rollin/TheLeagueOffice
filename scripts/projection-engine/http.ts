import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { CACHE_DIR, TIMEOUT_MS } from "./config";

const UA = "Mozilla/5.0 (compatible; TheLeagueOffice projection engine)";

export interface FetchResult<T> {
  ok: boolean;
  data: T | null;
  status: number | null;
  ms: number;
  error?: string;
}

/** One attempt plus one retry, each capped by an AbortController timeout. */
async function attempt(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ res: Response | null; error?: string }> {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "user-agent": UA, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return { res };
      if (res.status < 500 && res.status !== 429) return { res, error: `HTTP ${res.status}` };
      if (i === 1) return { res, error: `HTTP ${res.status}` };
    } catch (err) {
      if (i === 1) return { res: null, error: (err as Error).name === "TimeoutError" ? "timeout" : String(err) };
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  return { res: null, error: "unreachable" };
}

export async function fetchText(
  url: string,
  init: RequestInit = {},
  timeoutMs = TIMEOUT_MS,
): Promise<FetchResult<string>> {
  const started = Date.now();
  const { res, error } = await attempt(url, init, timeoutMs);
  if (!res || !res.ok) {
    return { ok: false, data: null, status: res?.status ?? null, ms: Date.now() - started, error: error ?? "failed" };
  }
  try {
    const data = await res.text();
    return { ok: true, data, status: res.status, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, data: null, status: res.status, ms: Date.now() - started, error: String(err) };
  }
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = TIMEOUT_MS,
): Promise<FetchResult<T>> {
  const text = await fetchText(url, { ...init, headers: { accept: "application/json", ...(init.headers ?? {}) } }, timeoutMs);
  if (!text.ok || text.data == null) return { ...text, data: null };
  try {
    return { ...text, data: JSON.parse(text.data) as T };
  } catch {
    return { ...text, ok: false, data: null, error: "invalid JSON" };
  }
}

/**
 * Text download cached on disk for `maxAgeHours`. Used for the Sleeper player
 * database (Sleeper asks for at most one pull a day) and other slow-moving files.
 * Falls back to an expired copy when the network fails.
 */
export async function cachedText(
  name: string,
  url: string,
  maxAgeHours: number,
  timeoutMs: number,
): Promise<FetchResult<string>> {
  const file = path.join(CACHE_DIR, name);
  const meta = `${file}.fetched`;
  let cached: string | null = null;
  let fetchedAt = 0;
  try {
    [cached, fetchedAt] = await Promise.all([
      readFile(file, "utf8"),
      readFile(meta, "utf8").then((s) => Number(s) || 0),
    ]);
  } catch {
    cached = null;
  }
  if (cached && Date.now() - fetchedAt < maxAgeHours * 3_600_000) {
    return { ok: true, data: cached, status: 200, ms: 0 };
  }
  const fresh = await fetchText(url, {}, timeoutMs);
  if (fresh.ok && fresh.data) {
    await mkdir(CACHE_DIR, { recursive: true });
    await Promise.all([writeFile(file, fresh.data), writeFile(meta, String(Date.now()))]);
    return fresh;
  }
  if (cached) return { ok: true, data: cached, status: 200, ms: fresh.ms, error: `stale cache (${fresh.error})` };
  return fresh;
}
