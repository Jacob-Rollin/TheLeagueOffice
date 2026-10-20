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
}

/** Admin-only: regenerate + auto-publish this week's Waiver Wire and Start/Sit articles. */
export const regenerateWeeklyDeskArticles = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireCallerIsAdmin(context.userId);
    const { processWeeklyDeskCron } = await import("@/lib/weekly-desk.server");
    return processWeeklyDeskCron();
  });
