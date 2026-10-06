/**
 * TiDB Serverless HTTPS client for Vercel / Nitro (edge-compatible).
 * Uses @tidbcloud/serverless — never mysql2 pooling on Edge.
 */
import { connect, type Config, type Connection } from "@tidbcloud/serverless";

let cached: Connection<Config> | null = null;

export function tidbConfigured(): boolean {
  return Boolean(process.env["DATABASE_URL"]?.trim());
}

export function getTidb(): Connection<Config> {
  const url = process.env["DATABASE_URL"]?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!cached) {
    cached = connect({ url });
  }
  return cached;
}

/** Execute a parameterized query. Returns rows array (or empty). */
export async function tidbExecute<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = getTidb();
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
