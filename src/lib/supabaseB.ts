/**
 * @deprecated Supabase Database B (`league-office-brain`) is retired.
 *
 * Player warehouse + brain hydration live on TiDB (`DATABASE_URL`) and
 * snap-cdn / `/api/data/players-export`. Auth, profiles, and site tables stay
 * on Database A (`supabase` / `VITE_SUPABASE_URL`).
 *
 * Importing this module throws so accidental dual-write / brain paths cannot
 * silently hit a paused project.
 */

throw new Error(
  "[supabaseB] league-office-brain is retired — use TiDB player_warehouse / players-export",
);
