import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { isAdminRole } from "@/lib/isAdmin";

/** Reads user_roles for the signed-in user and reports an Admin role. */
export function useIsAdmin(userId: string | null) {
  return useQuery({
    queryKey: ["user-roles-admin", userId],
    enabled: Boolean(userId),
    staleTime: 1000 * 60,
    retry: false,
    throwOnError: false,
    queryFn: async (): Promise<boolean> => {
      if (!userId) return false;
      try {
        const { data, error } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .eq("role", "admin")
          .maybeSingle();
        if (error) {
          console.warn("[useIsAdmin]", error.message);
          return false;
        }
        return isAdminRole(data?.role);
      } catch (err) {
        console.warn("[useIsAdmin]", err);
        return false;
      }
    },
  });
}
