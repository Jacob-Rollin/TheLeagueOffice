import { supabase } from "@/integrations/supabase/client";

export type InviteCodeRow = {
  code: string;
  created_at: string;
  created_by: string | null;
  is_used: boolean;
};

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INVITE_CODE_LENGTH = 10;
const INVITE_COLUMNS = "code, created_at, created_by";

function randomInviteCode(): string {
  const bytes = new Uint8Array(INVITE_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => INVITE_ALPHABET[byte % INVITE_ALPHABET.length]).join("");
}

function toRow(row: { code: string; created_at: string; created_by: string | null }): InviteCodeRow {
  return {
    code: row.code,
    created_at: row.created_at,
    created_by: row.created_by,
    is_used: false,
  };
}

export async function listInviteCodes(): Promise<InviteCodeRow[]> {
  const { data, error } = await supabase
    .from("invite_codes")
    .select(INVITE_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toRow);
}

export async function generateInviteCode(userId: string): Promise<InviteCodeRow> {
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data, error } = await supabase
      .from("invite_codes")
      .insert({ code: randomInviteCode(), created_by: userId })
      .select(INVITE_COLUMNS)
      .single();
    if (!error && data) return toRow(data);
    lastError = error?.message ?? "Could not generate invite code.";
    if (error && !/duplicate|unique/i.test(error.message)) {
      throw new Error(error.message);
    }
  }
  throw new Error(lastError ?? "Could not generate invite code.");
}
