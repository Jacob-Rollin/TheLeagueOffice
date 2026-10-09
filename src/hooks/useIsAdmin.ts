import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { supabase } from "@/integrations/supabase/client";

let authInvalidateBound: QueryClient | null = null;

/** One auth listener per QueryClient — invalidate admin role after token refresh. */
function ensureAdminRoleAuthInvalidate(queryClient: QueryClient) {
  if (typeof window === "undefined") return;
  if (authInvalidateBound === queryClient) return;
  authInvalidateBound = queryClient;
  supabase.auth.onAuthStateChange((event) => {
    if (event !== "TOKEN_REFRESHED" && event !== "SIGNED_IN") return;
    void queryClient.invalidateQueries({ queryKey: ["profile-role-admin"] });
  });
}

/**
 * Reads profiles.role for the signed-in user and reports Admin access.
 *
 * Important: network / session / RLS failures must surface as query errors —
 * never as `data: false`. Soft-failing to false made signed-in admins see
 * "Admin access required" until a hard refresh cleared the RQ cache.
 */
export function useIsAdmin(userId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    ensureAdminRoleAuthInvalidate(queryClient);
  }, [queryClient]);

  return useQuery({
    queryKey: ["profile-role-admin", userId],
    enabled: Boolean(userId),
    staleTime: 1000 * 60 * 5,
    // Session JWT can lag getSession() by a tick after navigation / tab wake.
    retry: 2,
    retryDelay: (attempt) => 250 * (attempt + 1),
    throwOnError: false,
    queryFn: async (): Promise<boolean> => {
      if (!userId) return false;

      // Ensure the Supabase client has an access token before hitting RLS.
      const { data: sess, error: sessError } = await supabase.auth.getSession();
      if (sessError) throw new Error(sessError.message);
      const sessionUserId = sess.session?.user?.id ?? null;
      if (!sessionUserId) {
        throw new Error("Session not ready for admin check");
      }
      if (sessionUserId !== userId) {
        throw new Error("Session user mismatch during admin check");
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();

      if (error) throw new Error(error.message);
      // Strict equality — matches .cursorrules admin gate (profiles.role === "admin").
      return data?.role === "admin";
    },
  });
}

export type AdminGateStatus =
  | "loading"
  | "signed_out"
  | "allowed"
  | "denied"
  | "verify_failed";

/**
 * Map auth + useIsAdmin query state to a gate decision.
 * Verify failures stay in `verify_failed` / loading — never "denied".
 */
export function adminGateStatus(input: {
  ready: boolean;
  userId: string | null | undefined;
  isAdmin: boolean | undefined;
  isFetched: boolean;
  isError: boolean;
}): AdminGateStatus {
  if (!input.ready) return "loading";
  if (!input.userId) return "signed_out";
  if (input.isAdmin === true) return "allowed";
  if (input.isError) return "verify_failed";
  if (!input.isFetched) return "loading";
  return "denied";
}
