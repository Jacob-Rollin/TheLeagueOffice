import { supabase } from "@/integrations/supabase/client";
import type { QueryClient } from "@tanstack/react-query";

export async function touchLeagueSyncTimestamp(
  connectionId: string,
  queryClient?: QueryClient,
  userId?: string | null,
): Promise<string | null> {
  const syncedAt = new Date().toISOString();
  const { error } = await supabase
    .from("synced_leagues")
    .update({ updated_at: syncedAt })
    .eq("id", connectionId);

  if (error) {
    console.warn("[league-sync] unable to update sync timestamp:", error.message);
    return null;
  }

  if (queryClient && userId) {
    queryClient.setQueryData<any[]>(["league-connections", userId], (current) =>
      current?.map((connection) =>
        connection.id === connectionId ? { ...connection, updated_at: syncedAt } : connection,
      ),
    );
  }

  return syncedAt;
}
