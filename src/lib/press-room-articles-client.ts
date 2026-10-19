/**
 * Client Press Room article loader.
 * Prefer browser → Supabase SELECT (no Fluid). Miss-fill once via ensurePressRoomArticle.
 */
import { supabase } from "@/integrations/supabase/client";
import type { PressRoomStoredArticle } from "@/lib/press-room-articles.functions";
import type { PressRoomFactPack } from "@/lib/press-room-fact-pack";
import type { PressRoomArticleKind } from "@/lib/press-room-templates";

const COLUMNS = "league_key, week, kind, title, paragraphs, fact_hash, model";

function rowToArticle(row: {
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
    kind: row.kind as PressRoomArticleKind,
    title: row.title,
    paragraphs,
    factHash: row.fact_hash,
    model: row.model,
    source: "cache",
  };
}

/** Direct SELECT — shared across all members of the same league_key. */
export async function fetchPressRoomArticleCached(input: {
  leagueKey: string;
  week: number;
  kind: PressRoomArticleKind;
}): Promise<PressRoomStoredArticle | null> {
  const { data, error } = await supabase
    .from("press_room_articles")
    .select(COLUMNS)
    .eq("league_key", input.leagueKey)
    .eq("week", input.week)
    .eq("kind", input.kind)
    .maybeSingle();

  if (error) {
    if (/does not exist|schema cache|press_room_articles/i.test(error.message)) {
      return null;
    }
    if (error.code === "PGRST116") return null;
    throw new Error(error.message);
  }
  if (!data) return null;
  return rowToArticle(data);
}

/** Cache hit → return. Miss → one Fluid generate + store. */
export async function loadPressRoomArticle(input: {
  factPack: PressRoomFactPack;
}): Promise<PressRoomStoredArticle> {
  const cached = await fetchPressRoomArticleCached({
    leagueKey: input.factPack.leagueKey,
    week: input.factPack.week,
    kind: input.factPack.kind,
  });
  if (cached) return cached;

  const { ensurePressRoomArticle } = await import("@/lib/press-room-articles.functions");
  return ensurePressRoomArticle({ data: { factPack: input.factPack } });
}

export async function adminRegeneratePressRoomArticle(input: {
  factPack: PressRoomFactPack;
}): Promise<PressRoomStoredArticle> {
  const { regeneratePressRoomArticle } = await import("@/lib/press-room-articles.functions");
  return regeneratePressRoomArticle({ data: { factPack: input.factPack } });
}
