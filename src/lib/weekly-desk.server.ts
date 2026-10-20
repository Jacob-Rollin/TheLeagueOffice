/**
 * Build + auto-publish weekly Front Office CMS articles (Waiver Wire, Start/Sit).
 * Upserts by stable slug so regenerations update the same row.
 */
import {
  buildStartSitDeskPack,
  buildWaiverDeskPack,
  templateStartSitBlurbs,
  templateWaiverBlurbs,
  waiverTopList,
} from "@/lib/weekly-desk-facts.server";
import {
  renderGroupedByPosition,
  renderPositionSection,
  renderPriorityList,
  wrapDeskArticle,
} from "@/lib/weekly-desk-html";
import { narrateStartSitBlurbs, narrateWaiverBlurbs } from "@/lib/weekly-desk-llm.server";
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

async function publishStartSit(): Promise<{ slug: string; week: number; season: number }> {
  const pack = await buildStartSitDeskPack();
  const templates = templateStartSitBlurbs(pack);
  const narrated = await narrateStartSitBlurbs(pack, templates);
  const order = ["QB", "RB", "WR", "TE", "DST"];
  const sections: string[] = [];
  let hero: { id: string; name: string; pos: string; team: string } | null = null;
  for (const pos of order) {
    const rows = narrated.byPos[pos];
    if (!rows?.length) continue;
    if (!hero) hero = rows[0]!;
    sections.push(renderPositionSection(pos, rows));
  }
  const content = wrapDeskArticle(narrated.intro, sections);
  const slug = stableSlug("start-sit", pack.week, pack.season);
  await upsertArticle({
    slug,
    title: `Start / Sit Advice: Week ${pack.week}`,
    category: "Start Sit",
    summary: `Position-by-position starts and sits for Week ${pack.week} based on matchup strength.`,
    content,
    image_url: weeklyDeskStockImage("start-sit", pack.week, pack.season),
    author_name: "League Office Desk",
    featured_player_id: hero?.id ?? null,
    featured_player_name: hero?.name ?? null,
    featured_player_pos: hero?.pos ?? null,
    featured_player_team: hero?.team ?? null,
  });
  return { slug, week: pack.week, season: pack.season };
}

export type WeeklyDeskKindFilter = "all" | WeeklyDeskKind;

/**
 * Cron / admin entry: publish weekly desks (auto-published).
 * - `all` — both (admin "Generate weekly desks")
 * - `waiver` — Tue cron (early-week adds)
 * - `start-sit` — Thu cron (after midweek practices / injury reports)
 */
export async function processWeeklyDeskCron(
  kinds: WeeklyDeskKindFilter = "all",
): Promise<WeeklyDeskReport> {
  try {
    const wantWaiver = kinds === "all" || kinds === "waiver";
    const wantStartSit = kinds === "all" || kinds === "start-sit";

    const waiver = wantWaiver ? await publishWaiver() : null;
    const startSit = wantStartSit ? await publishStartSit() : null;
    const week = waiver?.week ?? startSit?.week ?? 0;
    const season = waiver?.season ?? startSit?.season ?? 0;

    return {
      ok: true,
      week,
      season,
      ...(waiver?.slug ? { waiverSlug: waiver.slug } : {}),
      ...(startSit?.slug ? { startSitSlug: startSit.slug } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "weekly desk failed";
    console.error("[weekly-desk]", message);
    return { ok: false, week: 0, season: 0, error: message };
  }
}
