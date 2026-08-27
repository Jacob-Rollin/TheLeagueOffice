import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
};

/** Reads the signed-in user's own profile row. */
export function useProfile(userId: string | null) {
  return useQuery({
    queryKey: ["profile", userId],
    enabled: Boolean(userId),
    staleTime: 1000 * 60,
    retry: false,
    queryFn: async (): Promise<Profile | null> => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, full_name, avatar_url")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return (data as Profile | null) ?? null;
    },
  });
}

export const AVATAR_CHOICES: { id: string; label: string; url: string }[] = [
  "blitz",
  "gridiron",
  "endzone",
  "hailmary",
  "pigskin",
  "redzone",
  "shotgun",
  "audible",
].map((seed) => ({
  id: seed,
  label: seed,
  url: `https://api.dicebear.com/9.x/shapes/svg?seed=${seed}&radius=50`,
}));
