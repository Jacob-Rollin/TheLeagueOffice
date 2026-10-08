import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireCallerIsAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.role !== "admin") throw new Error("Unauthorized: Admin privileges required.");
  return supabaseAdmin;
}

/** Admin-only: set another user's profiles.role (service role; bypasses role lock). */
export const setProfileRole = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { userId: string; role: "admin" | "user" }) => ({
    userId: String(input.userId ?? "").trim().slice(0, 64),
    role: input.role === "admin" ? ("admin" as const) : ("user" as const),
  }))
  .handler(async ({ data, context }) => {
    if (!data.userId) throw new Error("Missing user id.");
    if (data.userId === context.userId && data.role !== "admin") {
      throw new Error("You cannot remove your own admin role from this list.");
    }
    const admin = await requireCallerIsAdmin(context.userId);
    const { error } = await admin.from("profiles").update({ role: data.role }).eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const, role: data.role };
  });

/** Admin-only: permanently delete another user's auth account + profile. */
export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => ({
    userId: String(input.userId ?? "").trim().slice(0, 64),
  }))
  .handler(async ({ data, context }) => {
    if (!data.userId) throw new Error("Missing user id.");
    if (data.userId === context.userId) {
      throw new Error("You cannot remove your own account from this list.");
    }
    const admin = await requireCallerIsAdmin(context.userId);

    await admin.from("synced_leagues").delete().eq("user_id", data.userId);
    await admin.from("league_connections").delete().eq("user_id", data.userId);
    try {
      await admin.from("native_league_links").delete().eq("user_id", data.userId);
    } catch {
      /* table may not exist in older envs */
    }

    await admin.from("profiles").delete().eq("id", data.userId);
    const { error } = await admin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
