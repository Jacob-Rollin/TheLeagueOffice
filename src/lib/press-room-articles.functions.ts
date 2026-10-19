/**
 * Press Room article cache: browser reads Supabase; miss-fill / admin regenerate
 * go through this Fluid path once (API keys + upsert). Hits must not re-call LLM.
 */
import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  hashPressRoomFactPack,
  parsePressRoomLeagueKey,
  type PressRoomFactPack,
} from "@/lib/press-room-fact-pack";
import { generatePressRoomArticleWithLlm } from "@/lib/press-room-llm.server";
import {
  generateTemplateArticle,
  type GeneratedPressArticle,
  type PressRoomArticleKind,
} from "@/lib/press-room-templates";
import type { EditorialBrief } from "@/lib/weekly-awards";

export type PressRoomStoredArticle = GeneratedPressArticle & {
  leagueKey: string;
  week: number;
  kind: PressRoomArticleKind;
  factHash: string;
  model: string;
  source: "cache" | "generated" | "template";
};

const KINDS = new Set<PressRoomArticleKind>(["recap", "preview", "waiver"]);

function asKind(value: string): PressRoomArticleKind {
  const k = value.trim().toLowerCase() as PressRoomArticleKind;
  if (!KINDS.has(k)) throw new Error("Invalid article kind.");
  return k;
}

function briefFromFactPack(pack: PressRoomFactPack): EditorialBrief {
  return {
    week: pack.week,
    apexTeam: pack.apexTeam,
    apexPoints: pack.apexPoints,
    apexLogo: null,
    stalledTeam: pack.stalledTeam,
    stalledPoints: pack.stalledPoints,
    woodshedWinner: pack.woodshedWinner,
    woodshedLoser: pack.woodshedLoser,
    woodshedMargin: pack.woodshedMargin,
    razorWinner: pack.razorWinner,
    razorLoser: pack.razorLoser,
    razorMargin: pack.razorMargin,
    geniusTeam: pack.geniusTeam,
    geniusEfficiency: pack.geniusEfficiency,
    waiverPlayer: pack.waiverPlayer,
    waiverTeam: pack.waiverTeam,
    waiverPoints: pack.waiverPoints,
    waiverLogo: null,
    waiverPlayerId: pack.waiverPlayerId,
    previewFocusTeam: pack.previewFocusTeam,
    previewFocusLogo: null,
    mvpPlayer:
      pack.mvpName && pack.mvpId
        ? {
            id: pack.mvpId,
            name: pack.mvpName,
            points: pack.mvpPoints ?? 0,
            rosterId: null,
            teamName: pack.mvpTeam || pack.apexTeam,
          }
        : null,
    benchBustPlayer:
      pack.benchBustName && pack.benchBustId
        ? {
            id: pack.benchBustId,
            name: pack.benchBustName,
            points: pack.benchBustPoints ?? 0,
            rosterId: null,
            teamName: pack.benchBustTeam || "",
          }
        : null,
    benchBustNarrative: pack.benchBustNarrative,
    previewStarPlayer:
      pack.previewStarName && pack.previewStarId
        ? {
            id: pack.previewStarId,
            name: pack.previewStarName,
            points: pack.previewStarPoints ?? 0,
            rosterId: null,
            teamName: pack.previewFocusTeam,
          }
        : null,
    previewPairs: pack.previewPairs.map((p) => ({
      home: p.home,
      away: p.away,
      homeProj: p.homeProj,
      awayProj: p.awayProj,
      homeLogo: null,
      awayLogo: null,
    })),
  };
}

function sanitizeFactPack(input: PressRoomFactPack): PressRoomFactPack {
  const kind = asKind(String(input.kind ?? "recap"));
  const week = Math.max(1, Math.min(22, Math.floor(Number(input.week) || 1)));
  const season = Math.max(2000, Math.floor(Number(input.season) || new Date().getUTCFullYear()));
  const leagueKey = String(input.leagueKey ?? "").trim().slice(0, 160);
  if (!leagueKey || !parsePressRoomLeagueKey(leagueKey)) {
    throw new Error("Invalid league key.");
  }
  return {
    ...input,
    kind,
    week,
    season,
    leagueKey,
    scoreboard: Array.isArray(input.scoreboard) ? input.scoreboard.slice(0, 16) : [],
    previewPairs: Array.isArray(input.previewPairs) ? input.previewPairs.slice(0, 12) : [],
  };
}

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

async function assertUserHasLeagueAccess(
  userId: string,
  platform: string,
  leagueId: string,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (platform === "native") {
    const { data, error } = await supabaseAdmin
      .from("native_league_links")
      .select("id")
      .eq("user_id", userId)
      .eq("native_league_id", leagueId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("You do not have access to this league.");
    return;
  }
  const { data, error } = await supabaseAdmin
    .from("synced_leagues")
    .select("id")
    .eq("user_id", userId)
    .eq("platform", platform)
    .eq("league_id", leagueId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You do not have access to this league.");
}

function rowToStored(row: {
  league_key: string;
  week: number;
  kind: string;
  title: string;
  paragraphs: unknown;
  fact_hash: string;
  model: string;
}): PressRoomStoredArticle {
  const paragraphs = Array.isArray(row.paragraphs)
    ? row.paragraphs.map((p) => String(p ?? ""))
    : [];
  return {
    leagueKey: row.league_key,
    week: row.week,
    kind: asKind(row.kind),
    title: row.title,
    paragraphs,
    factHash: row.fact_hash,
    model: row.model,
    source: "cache",
  };
}

async function readCachedArticle(leagueKey: string, week: number, kind: PressRoomArticleKind) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("press_room_articles")
    .select("league_key, week, kind, title, paragraphs, fact_hash, model")
    .eq("league_key", leagueKey)
    .eq("week", week)
    .eq("kind", kind)
    .maybeSingle();
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  if (!data) return null;
  return rowToStored(data);
}

async function upsertArticle(input: {
  leagueKey: string;
  week: number;
  kind: PressRoomArticleKind;
  title: string;
  paragraphs: string[];
  factHash: string;
  model: string;
}): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("press_room_articles").upsert(
    {
      league_key: input.leagueKey,
      week: input.week,
      kind: input.kind,
      title: input.title,
      paragraphs: input.paragraphs,
      fact_hash: input.factHash,
      model: input.model,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "league_key,week,kind" },
  );
  if (error) throw new Error(error.message);
}

async function ensureOrRegenerate(input: {
  userId: string;
  factPack: PressRoomFactPack;
  force: boolean;
  requireAdmin: boolean;
}): Promise<PressRoomStoredArticle> {
  const pack = sanitizeFactPack(input.factPack);
  const parsed = parsePressRoomLeagueKey(pack.leagueKey)!;
  if (input.requireAdmin) {
    await requireCallerIsAdmin(input.userId);
  }
  await assertUserHasLeagueAccess(input.userId, parsed.platform, parsed.leagueId);

  if (!input.force) {
    const cached = await readCachedArticle(pack.leagueKey, pack.week, pack.kind);
    if (cached) return cached;
  }

  const factHash = hashPressRoomFactPack(pack);
  const llm = await generatePressRoomArticleWithLlm(pack);
  const article = llm ?? generateTemplateArticle(pack.kind, briefFromFactPack(pack));
  const model = llm?.model ?? "template";

  await upsertArticle({
    leagueKey: pack.leagueKey,
    week: pack.week,
    kind: pack.kind,
    title: article.title,
    paragraphs: article.paragraphs,
    factHash,
    model,
  });

  return {
    leagueKey: pack.leagueKey,
    week: pack.week,
    kind: pack.kind,
    title: article.title,
    paragraphs: article.paragraphs,
    factHash,
    model,
    source: llm ? "generated" : "template",
  };
}

/** Miss-fill only: returns cached article when present; otherwise generate once and store. */
export const ensurePressRoomArticle = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { factPack: PressRoomFactPack }) => ({
    factPack: input.factPack,
  }))
  .handler(async ({ data, context }) => {
    return ensureOrRegenerate({
      userId: context.userId,
      factPack: data.factPack,
      force: false,
      requireAdmin: false,
    });
  });

/** Admin-only overwrite for the selected league/week/kind (history rewrite). */
export const regeneratePressRoomArticle = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: { factPack: PressRoomFactPack }) => ({
    factPack: input.factPack,
  }))
  .handler(async ({ data, context }) => {
    return ensureOrRegenerate({
      userId: context.userId,
      factPack: data.factPack,
      force: true,
      requireAdmin: true,
    });
  });
