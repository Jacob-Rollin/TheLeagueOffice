import { requiredFactStrings, type PressRoomFactPack } from "@/lib/press-room-fact-pack";
import type { GeneratedPressArticle } from "@/lib/press-room-templates";

/** Reject copy that drops required grounded facts or invents player modal tokens. */
export function validatePressRoomArticle(
  article: GeneratedPressArticle,
  pack: PressRoomFactPack,
): boolean {
  const blob = `${article.title}\n${article.paragraphs.join("\n")}`;
  if (blob.length < 120) return false;

  const required = requiredFactStrings(pack);
  let hit = 0;
  for (const req of required) {
    if (blob.includes(req)) hit += 1;
  }
  const need = Math.max(1, Math.ceil(required.length * 0.6));
  if (hit < need) return false;

  const allowedIds = new Set(
    [pack.mvpId, pack.benchBustId, pack.waiverPlayerId, pack.previewStarId]
      .filter(Boolean)
      .map((id) => String(id)),
  );
  const tokenRe = /⟦([^¦⟧]+)¦[^⟧]+⟧/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(blob))) {
    const id = match[1]?.trim() ?? "";
    if (id && !allowedIds.has(id)) return false;
  }
  return true;
}
