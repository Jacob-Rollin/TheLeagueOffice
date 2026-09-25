import { supabase } from "@/integrations/supabase/client";
import type { QueryClient } from "@tanstack/react-query";

type ConnectionListRow = {
  id: string;
  updated_at?: string;
  [key: string]: unknown;
};

/** Stamp synced_leagues.updated_at after a successful host refresh. */
export async function touchLeagueSyncTimestamp(
  connectionId: string,
  queryClient?: QueryClient,
  userId?: string | null,
): Promise<string | null> {
  const id = connectionId.trim();
  if (!id) return null;

  const syncedAt = new Date().toISOString();
  const { error } = await supabase
    .from("synced_leagues")
    .update({ updated_at: syncedAt })
    .eq("id", id);

  if (error) {
    console.warn("[league-sync] unable to update sync timestamp:", error.message);
    return null;
  }

  if (queryClient) {
    const patch = (current: ConnectionListRow[] | undefined) =>
      current?.map((connection) =>
        connection.id === id ? { ...connection, updated_at: syncedAt } : connection,
      );

    if (userId) {
      queryClient.setQueryData<ConnectionListRow[]>(["league-connections", userId], patch);
    }
    queryClient.setQueriesData<ConnectionListRow[]>(
      { queryKey: ["league-connections"] },
      patch,
    );
    void queryClient.invalidateQueries({ queryKey: ["league-connections"] });
  }

  return syncedAt;
}
