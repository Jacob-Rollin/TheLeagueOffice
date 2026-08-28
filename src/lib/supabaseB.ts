import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Database B — isolated analytical player data warehouse.
 *
 * This client talks ONLY to the secondary Supabase project (player_warehouse
 * tables). It must never be used for auth, profiles, or user league data;
 * those flows stay on the default `supabase` client (Database A).
 */

const rawUrl = import.meta.env.VITE_SUPABASE_URL_B as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY_B as string | undefined;

// The stored URL may include a trailing "/rest/v1" path; createClient needs
// the bare project origin.
const url = rawUrl?.replace(/\/rest\/v1\/?$/i, "");

if (!url || !anonKey) {
  console.warn("[supabaseB] Missing VITE_SUPABASE_URL_B / VITE_SUPABASE_ANON_KEY_B");
}

export const supabaseB: SupabaseClient = createClient(url ?? "", anonKey ?? "", {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    storage: undefined,
  },
});
