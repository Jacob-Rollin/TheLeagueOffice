import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/** Reads profiles.role for the signed-in user and reports an Admin role. */
export function useIsAdmin(userId: string | null) {
  return useQuery({
    queryKey: ["profile-role-admin", userId],
    enabled: Boolean(userId),
    staleTime: 1000 * 60,
    retry: false,
    throwOnError: false,
    queryFn: async (): Promise<boolean> => {
      if (!userId) return false;
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", userId)
          .maybeSingle();
        if (error) {
          console.warn("[useIsAdmin]", error.message);
          return false;
        }
        return data?.role === "admin";
      } catch (err) {
        console.warn("[useIsAdmin]", err);
        return false;
      }
    },
  });
}
