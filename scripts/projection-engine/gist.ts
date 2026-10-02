import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { BULK_TIMEOUT_MS, OUT_DIR } from "./config";
import { fetchJson, fetchText } from "./http";

type GistFile = { content?: string; truncated?: boolean; raw_url?: string };

const gistId = () => process.env.GIST_ID?.trim() ?? "";
const token = () => process.env.GIST_TOKEN?.trim() ?? "";

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  if (token()) h.authorization = `Bearer ${token()}`;
  return h;
}

/**
 * Read files from the Gist. In dry-run mode, files written by an earlier dry
 * run take precedence so local runs can chain without touching the Gist.
 */
export async function readFiles(names: string[], dryRun: boolean): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = Object.fromEntries(names.map((n) => [n, null]));
  if (dryRun) {
    for (const name of names) {
      try {
        out[name] = await readFile(path.join(OUT_DIR, name), "utf8");
      } catch {
        out[name] = null;
      }
    }
    if (names.every((n) => out[n] != null) || !gistId()) return out;
  }
  if (!gistId()) throw new Error("GIST_ID is not set");
  const res = await fetchJson<{ files?: Record<string, GistFile> }>(
    `https://api.github.com/gists/${gistId()}`,
    { headers: headers() },
    BULK_TIMEOUT_MS,
  );
  if (!res.ok || !res.data?.files) throw new Error(`could not read Gist (${res.error})`);
  for (const name of names) {
    if (out[name] != null) continue;
    const file = res.data.files[name];
    if (!file) continue;
    if (file.truncated && file.raw_url) {
      const raw = await fetchText(file.raw_url, {}, BULK_TIMEOUT_MS);
      if (!raw.ok) throw new Error(`could not read ${name} (${raw.error})`);
      out[name] = raw.data;
    } else out[name] = file.content ?? null;
  }
  return out;
}

/** Write only the given files; untouched Gist files are left as they are. */
export async function writeFiles(files: Record<string, string>, dryRun: boolean): Promise<void> {
  if (!Object.keys(files).length) return;
  if (dryRun) {
    await mkdir(OUT_DIR, { recursive: true });
    await Promise.all(Object.entries(files).map(([name, content]) => writeFile(path.join(OUT_DIR, name), content)));
    return;
  }
  if (!gistId() || !token()) throw new Error("GIST_ID and GIST_TOKEN are required to publish");
  const res = await fetch(`https://api.github.com/gists/${gistId()}`, {
    method: "PATCH",
    headers: { ...headers(), "content-type": "application/json" },
    body: JSON.stringify({ files: Object.fromEntries(Object.entries(files).map(([n, content]) => [n, { content }])) }),
    signal: AbortSignal.timeout(BULK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Gist update failed: HTTP ${res.status} ${await res.text()}`);
}
