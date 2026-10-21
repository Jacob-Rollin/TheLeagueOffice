import { supabase } from "@/integrations/supabase/client";

export type LeagueChatMessage = {
  id: string;
  native_league_id: string;
  user_id: string;
  author_name: string;
  body: string;
  created_at: string;
};

const COLUMNS = "id, native_league_id, user_id, author_name, body, created_at";

/** Newest-last list for a native league room (visibility-aware refresh belongs in the UI). */
export async function listLeagueChatMessages(
  nativeLeagueId: string,
  limit = 100,
): Promise<LeagueChatMessage[]> {
  const leagueId = nativeLeagueId.trim();
  if (!leagueId) return [];

  const { data, error } = await supabase
    .from("league_chat_messages")
    .select(COLUMNS)
    .eq("native_league_id", leagueId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) throw new Error(error.message);

  // Query newest-first for an efficient index scan; reverse for chat UI.
  return ((data ?? []) as LeagueChatMessage[]).reverse();
}

export async function postLeagueChatMessage(input: {
  nativeLeagueId: string;
  userId: string;
  authorName: string;
  body: string;
}): Promise<LeagueChatMessage> {
  const body = input.body.trim();
  if (!body) throw new Error("Message cannot be empty.");
  if (body.length > 1000) throw new Error("Message must be 1000 characters or fewer.");

  const leagueId = input.nativeLeagueId.trim();
  if (!leagueId) throw new Error("Missing league.");

  const author = (input.authorName.trim() || "Member").slice(0, 80);

  const { data, error } = await supabase
    .from("league_chat_messages")
    .insert({
      native_league_id: leagueId,
      user_id: input.userId,
      author_name: author,
      body,
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as LeagueChatMessage;
}

export async function deleteLeagueChatMessage(messageId: string): Promise<void> {
  const { error } = await supabase.from("league_chat_messages").delete().eq("id", messageId);
  if (error) throw new Error(error.message);
}
