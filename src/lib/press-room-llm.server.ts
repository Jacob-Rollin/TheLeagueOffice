/**
 * Server-only Press Room prose generation.
 * Groq (primary) → Gemini (failover) → caller falls back to templates.
 * Facts are never invented here — validation rejects ungrounded copy.
 */
import { factPackMarkupHints, type PressRoomFactPack } from "@/lib/press-room-fact-pack";
import type { GeneratedPressArticle } from "@/lib/press-room-templates";
import { validatePressRoomArticle } from "@/lib/press-room-validate";

export { validatePressRoomArticle } from "@/lib/press-room-validate";

export type LlmArticleResult = GeneratedPressArticle & {
  model: string;
};

function groqKey(): string {
  return String(process.env["GROQ_API_KEY"] ?? "").trim();
}

function geminiKey(): string {
  return String(process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_API_KEY"] ?? "").trim();
}

function buildSystemPrompt(pack: PressRoomFactPack): string {
  const hints = factPackMarkupHints(pack);
  return [
    "You are the Press Room desk writer for a private fantasy football league.",
    "Write like a sharp sports columnist: vivid, specific, varied week to week — never a fill-in-the-blank template.",
    "Use ONLY the JSON facts provided. Do not invent scores, standings, injuries, players, or matchups.",
    "Return strict JSON only: {\"title\":\"...\",\"paragraphs\":[\"...\",\"...\",\"...\"]} with exactly 3 paragraphs.",
    "Title should be uppercase sports-desk style, under 120 characters.",
    "When mentioning teams or metrics from markupHints, prefer those exact tokens so the UI can bold/link them:",
    "- Teams: ‹Team Name›",
    "- Metrics: «12.34pts» or «91.2%»",
    "- Players: ⟦playerId¦Player Name⟧ when an id is provided in markupHints",
    `Article kind: ${pack.kind}. Week ${pack.week}, season ${pack.season}.`,
    `Seed for variety (keep facts fixed, vary voice/structure): ${pack.leagueKey}|${pack.week}|${pack.kind}`,
    `markupHints: ${JSON.stringify(hints)}`,
  ].join("\n");
}

function buildUserPrompt(pack: PressRoomFactPack): string {
  if (pack.kind === "recap") {
    return `Write the Post-Week Recap from these facts:\n${JSON.stringify(pack)}`;
  }
  if (pack.kind === "preview") {
    return `Write the Matchup Preview for the upcoming slate from these facts:\n${JSON.stringify(pack)}`;
  }
  return `Write the Waiver Sweep wire column from these facts:\n${JSON.stringify(pack)}`;
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Model did not return JSON");
  }
}

function normalizeArticle(raw: unknown): GeneratedPressArticle | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const title = String(obj["title"] ?? "").trim();
  const paragraphs = Array.isArray(obj["paragraphs"])
    ? (obj["paragraphs"] as unknown[]).map((p) => String(p ?? "").trim()).filter(Boolean)
    : [];
  if (!title || paragraphs.length < 2) return null;
  return {
    title: title.slice(0, 160),
    paragraphs: paragraphs.slice(0, 4),
  };
}

async function callGroq(pack: PressRoomFactPack): Promise<LlmArticleResult | null> {
  const key = groqKey();
  if (!key) return null;
  const model = String(process.env["GROQ_PRESS_ROOM_MODEL"] ?? "openai/gpt-oss-120b").trim();
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.85,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt(pack) },
        { role: "user", content: buildUserPrompt(pack) },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn("[press-room-llm] groq failed", res.status, body.slice(0, 200));
    return null;
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  const article = normalizeArticle(extractJsonObject(content));
  if (!article || !validatePressRoomArticle(article, pack)) return null;
  return { ...article, model: `groq:${model}` };
}

async function callGemini(pack: PressRoomFactPack): Promise<LlmArticleResult | null> {
  const key = geminiKey();
  if (!key) return null;
  const model = String(process.env["GEMINI_PRESS_ROOM_MODEL"] ?? "gemini-2.0-flash").trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: `${buildSystemPrompt(pack)}\n\n${buildUserPrompt(pack)}` }],
        },
      ],
      generationConfig: {
        temperature: 0.85,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn("[press-room-llm] gemini failed", res.status, body.slice(0, 200));
    return null;
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const content = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const article = normalizeArticle(extractJsonObject(content));
  if (!article || !validatePressRoomArticle(article, pack)) return null;
  return { ...article, model: `gemini:${model}` };
}

/** Try free LLM providers; returns null when keys missing or output fails validation. */
export async function generatePressRoomArticleWithLlm(
  pack: PressRoomFactPack,
): Promise<LlmArticleResult | null> {
  try {
    const groq = await callGroq(pack);
    if (groq) return groq;
  } catch (error) {
    console.warn("[press-room-llm] groq error", error);
  }
  try {
    const gemini = await callGemini(pack);
    if (gemini) return gemini;
  } catch (error) {
    console.warn("[press-room-llm] gemini error", error);
  }
  return null;
}

export function pressRoomLlmConfigured(): boolean {
  return Boolean(groqKey() || geminiKey());
}
