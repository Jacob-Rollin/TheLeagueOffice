import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SignUpWithInviteInput = {
  email: string;
  password: string;
  username: string;
  displayName: string;
  inviteCode: string;
};

export type SignUpWithInviteResult = { ok: true } | { ok: false; error: string };

const INVALID_CODE = "Invalid or expired invite code.";

export async function signUpWithInvite(
  input: SignUpWithInviteInput,
): Promise<SignUpWithInviteResult> {
  const code = input.inviteCode.trim();
  if (!code) return { ok: false, error: INVALID_CODE };

  // 1. Verify the invite code exists before touching Supabase Auth.
  const { data: invite, error: inviteError } = await supabaseAdmin
    .from("invite_codes")
    .select("code")
    .eq("code", code)
    .maybeSingle();

  if (inviteError) return { ok: false, error: INVALID_CODE };
  if (!invite) return { ok: false, error: INVALID_CODE };

  // 2. Create the auth user with custom fields in raw user metadata.
  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      username: input.username,
      display_name: input.displayName,
    },
  });

  if (createError || !created?.user) {
    return { ok: false, error: createError?.message ?? "Could not create account." };
  }

  // Ensure profile fields land even if the auth trigger falls back to defaults.
  await supabaseAdmin
    .from("profiles")
    .update({ username: input.username, display_name: input.displayName })
    .eq("id", created.user.id);

  // 3. Burn the invite code so it can never be reused.
  await supabaseAdmin.from("invite_codes").delete().eq("code", code);

  return { ok: true };
}
