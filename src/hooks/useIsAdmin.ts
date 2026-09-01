import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { hasAdminRole } from "@/lib/isAdmin";

/** Reads user_roles for the signed-in user and reports an Admin role. */
export function useIsAdmin(userId: string | null) {
  return useQuery({
    queryKey: ["user-roles-admin", userId],
    enabled: Boolean(userId),
    staleTime: 1000 * 60,
    retry: false,
    queryFn: async (): Promise<boolean> => {
      if (!userId) return false;
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);
      if (error) throw error;
      return hasAdminRole(data ?? []);
    },
  });
}
