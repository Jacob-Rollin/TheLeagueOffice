/**
 * TiDB Serverless HTTPS client for Vercel / Nitro (edge-compatible).
 * Uses @tidbcloud/serverless — never mysql2 pooling on Edge.
 */
import { connect, type Config, type Connection } from "@tidbcloud/serverless";

/** App database name — TiDB console cluster name may differ; this is the MySQL schema. */
export const TIDB_APP_DATABASE = "league-office-native";

const RESERVED_DATABASES = new Set([
  "",
  "sys",
  "mysql",
  "information_schema",
  "performance_schema",
  "test",
]);

let cached: Connection<Config> | null = null;
let readyPromise: Promise<Connection<Config>> | null = null;

export function tidbConfigured(): boolean {
  return Boolean(process.env["DATABASE_URL"]?.trim());
}

/** Database segment from a mysql:// URL path (may be a reserved system schema). */
export function tidbDatabaseFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.replace(/^\//, "").split("/")[0] ?? "");
  } catch {
    return "";
  }
}

/**
 * TiDB Cloud often hands out `/test` or `/sys` in the connection string.
 * Rewrite those to the app schema so warehouse tables are not created in system DBs.
 */
export function normalizeTidbDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const db = decodeURIComponent(parsed.pathname.replace(/^\//, "").split("/")[0] ?? "");
    if (RESERVED_DATABASES.has(db.toLowerCase())) {
      parsed.pathname = `/${TIDB_APP_DATABASE}`;
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

async function readyTidb(): Promise<Connection<Config>> {
  if (cached) return cached;
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    const raw = process.env["DATABASE_URL"]?.trim();
    if (!raw) throw new Error("DATABASE_URL is not configured");

    const normalized = normalizeTidbDatabaseUrl(raw);
    const needsCreate = normalized !== raw;

    if (needsCreate) {
      const bootstrap = connect({ url: raw });
      try {
        await bootstrap.execute(
          `CREATE DATABASE IF NOT EXISTS \`${TIDB_APP_DATABASE.replace(/`/g, "")}\``,
        );
      } finally {
        try {
          await bootstrap.close();
        } catch {
          /* ignore */
        }
      }
    }

    cached = connect({ url: normalized });
    return cached;
  })().catch((err) => {
    readyPromise = null;
    cached = null;
    throw err;
  });

  return readyPromise;
}

/** Sync accessor for callers that already awaited tidbExecute / ready path. Prefer tidbExecute. */
export function getTidb(): Connection<Config> {
  if (cached) return cached;
  const url = process.env["DATABASE_URL"]?.trim();
  if (!url) throw new Error("DATABASE_URL is not configured");
  // Best-effort sync connect (may still hit reserved DB until first tidbExecute).
  cached = connect({ url: normalizeTidbDatabaseUrl(url) });
  return cached;
}

/** Execute a parameterized query. Returns rows array (or empty). */
export async function tidbExecute<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = await readyTidb();
  const result = await client.execute(sql, params);
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as T[]) : [];
  }
  return [];
}

/** Build a multi-row INSERT ... ON DUPLICATE KEY UPDATE for batch writes. */
export function buildUpsertSql(
  table: string,
  columns: string[],
  rowCount: number,
  updateColumns: string[],
): string {
  if (rowCount < 1) throw new Error("rowCount must be >= 1");
  const placeholders = Array.from({ length: rowCount }, () =>
    `(${columns.map(() => "?").join(", ")})`,
  ).join(", ");
  const updates = updateColumns.map((c) => `${c}=VALUES(${c})`).join(", ");
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders} ON DUPLICATE KEY UPDATE ${updates}`;
}

/** Chunk helper for batch upserts (default 200 rows). */
export function chunkRows<T>(rows: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
