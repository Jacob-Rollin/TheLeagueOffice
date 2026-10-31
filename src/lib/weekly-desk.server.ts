/**
 * Build + auto-publish weekly Front Office CMS articles.
 * Homepage feed: Waiver Wire only (Start/Sit desks are retired from auto-publish).
 * Upserts by stable slug so regenerations update the same row.
 */
import {
  buildWaiverDeskPack,
  templateWaiverBlurbs,
  waiverTopList,
} from "@/lib/weekly-desk-facts.server";
import {
  renderGroupedByPosition,
  renderPriorityList,
  wrapDeskArticle,
} from "@/lib/weekly-desk-html";
import { narrateWaiverBlurbs } from "@/lib/weekly-desk-llm.server";
import { weeklyDeskStockImage, type WeeklyDeskKind } from "@/lib/weekly-desk-stock";

export type WeeklyDeskReport = {
  ok: boolean;
  week: number;
  season: number;
  waiverSlug?: string;
  startSitSlug?: string;
  error?: string;
};

function stableSlug(kind: WeeklyDeskKind, week: number, season: number): string {
  return kind === "waiver"
    ? `waiver-wire-week-${week}-${season}`
    : `start-sit-week-${week}-${season}`;
}

async function upsertArticle(row: {
  slug: string;
  title: string;
  category: string;
  summary: string;
  content: string;
  image_url: string;
  author_name: string;
  featured_player_id: string | null;
  featured_player_name: string | null;
  featured_player_pos: string | null;
  featured_player_team: string | null;
}): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: existing } = await supabaseAdmin
    .from("articles")
    .select("id")
    .eq("slug", row.slug)
    .maybeSingle();

  const payload = {
    title: row.title,
    category: row.category,
    summary: row.summary,
    content: row.content,
    image_url: row.image_url,
    author_name: row.author_name,
    published: true,
    featured_player_id: row.featured_player_id,
    featured_player_name: row.featured_player_name,
    featured_player_pos: row.featured_player_pos,
    featured_player_team: row.featured_player_team,
  };

  if (existing?.id) {
    const { error } = await supabaseAdmin.from("articles").update(payload).eq("id", existing.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabaseAdmin.from("articles").insert({
    ...payload,
    slug: row.slug,
  });
  if (error) throw new Error(error.message);
}

async function publishWaiver(): Promise<{ slug: string; week: number; season: number }> {
  const pack = await buildWaiverDeskPack();
  const templates = templateWaiverBlurbs(pack);
  const narrated = await narrateWaiverBlurbs(pack, templates);
  const hero = narrated.players[0] ?? null;
  // NFL-style layout: intro → top-10 overall board → position write-ups.
  const top = waiverTopList(narrated.players, 10);
  const sections = [
    renderPriorityList(`Top ${top.length} Overall Waiver-Wire Targets`, top),
    ...renderGroupedByPosition(narrated.players),
  ];
  const content = wrapDeskArticle(narrated.intro, sections);
  const slug = stableSlug("waiver", pack.week, pack.season);
  await upsertArticle({
    slug,
    title: `Waiver Wire: Players to Add (Week ${pack.week})`,
    category: "Waiver Wire",
    summary: `Priority waiver adds for Week ${pack.week} — available players with rising opportunity.`,
    content,
    image_url: weeklyDeskStockImage("waiver", pack.week, pack.season),
    author_name: "League Office Desk",
    featured_player_id: hero?.id ?? null,
    featured_player_name: hero?.name ?? null,
    featured_player_pos: hero?.pos ?? null,
    featured_player_team: hero?.team ?? null,
  });
  return { slug, week: pack.week, season: pack.season };
}

/** Unpublish retired Start/Sit desks so they leave the homepage feed. */
async function unpublishStartSitDesks(): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("articles")
    .update({ published: false })
    .eq("published", true)
    .eq("category", "Start Sit")
    .select("id");
  if (error) {
    console.warn("[weekly-desk] unpublish start-sit failed", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

export type WeeklyDeskKindFilter = "all" | WeeklyDeskKind;

/**
 * Cron / admin entry: publish Waiver Wire only (auto-published).
 * Start/Sit desks are retired from the homepage schedule.
 * - `waiver` | `all` — Tue cron / admin generate
 * - `start-sit` — no-op (unpublishes any leftover Start Sit rows)
 */
export async function processWeeklyDeskCron(
  kinds: WeeklyDeskKindFilter = "waiver",
): Promise<WeeklyDeskReport> {
  try {
    const unpublished = await unpublishStartSitDesks();
    if (unpublished > 0) {
      console.info(`[weekly-desk] unpublished ${unpublished} Start/Sit desk article(s)`);
    }

    if (kinds === "start-sit") {
      return { ok: true, week: 0, season: 0 };
    }

    const waiver = await publishWaiver();
    return {
      ok: true,
      week: waiver.week,
      season: waiver.season,
      waiverSlug: waiver.slug,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "weekly desk failed";
    console.error("[weekly-desk]", message);
    return { ok: false, week: 0, season: 0, error: message };
  }
}
