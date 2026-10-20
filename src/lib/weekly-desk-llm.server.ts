/**
 * Groq narration for weekly Front Office desks. Facts only — no FAAB, no invented stats.
 */
import type { DeskPlayerBlurb } from "@/lib/weekly-desk-html";
import type { StartSitDeskPack, WaiverDeskPack } from "@/lib/weekly-desk-facts.server";

function groqKey(): string {
  return String(process.env["GROQ_API_KEY"] ?? "").trim();
}

function parseBlurbs(raw: unknown, fallbackIds: string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw || typeof raw !== "object") return map;
  const blurbs = (raw as { blurbs?: unknown }).blurbs;
  if (!Array.isArray(blurbs)) return map;
  for (const row of blurbs) {
    if (!row || typeof row !== "object") continue;
    const id = String((row as { id?: string }).id ?? "").trim();
    const text = String((row as { blurb?: string }).blurb ?? "").trim();
    if (id && text) map.set(id, text.slice(0, 600));
  }
  // Soft require most ids to be covered.
  const hit = fallbackIds.filter((id) => map.has(id)).length;
  if (hit < Math.ceil(fallbackIds.length * 0.5)) return new Map();
  return map;
}

async function groqJson(system: string, user: string): Promise<unknown | null> {
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
      temperature: 0.75,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    console.warn("[weekly-desk-llm] groq failed", res.status);
    return null;
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? "";
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(content.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function narrateWaiverBlurbs(
  pack: WaiverDeskPack,
  templates: DeskPlayerBlurb[],
): Promise<{ intro: string; players: DeskPlayerBlurb[] }> {
  const ids = templates.map((p) => p.id);
  const system = [
    "You write League Office waiver-wire blurbs for fantasy football.",
    "Return JSON: {\"intro\":\"2 sentences\",\"blurbs\":[{\"id\":\"...\",\"blurb\":\"2-3 sentences\"}]}",
    "Use ONLY provided facts. No FAAB dollars. No invented injuries or stats.",
    "Tone: sharp sports desk, not template filler.",
  ].join("\n");
  const user = `Week ${pack.week} ${pack.season} waiver board:\n${JSON.stringify(pack.players)}`;
  const raw = await groqJson(system, user);
  const map = parseBlurbs(raw, ids);
  const intro =
    raw && typeof raw === "object" && typeof (raw as { intro?: string }).intro === "string"
      ? String((raw as { intro: string }).intro).trim().slice(0, 400)
      : `Here are the priority adds to watch heading into Week ${pack.week} — focused on available players drawing attention and opportunity.`;

  return {
    intro:
      intro ||
      `Here are the priority adds to watch heading into Week ${pack.week} — focused on available players drawing attention and opportunity.`,
    players: templates.map((p) => ({
      ...p,
      blurb: map.get(p.id) || p.blurb,
    })),
  };
}

export async function narrateStartSitBlurbs(
  pack: StartSitDeskPack,
  templates: Record<string, DeskPlayerBlurb[]>,
): Promise<{ intro: string; byPos: Record<string, DeskPlayerBlurb[]> }> {
  const flat = Object.values(templates).flat();
  const ids = flat.map((p) => p.id);
  const system = [
    "You write League Office start/sit blurbs for fantasy football.",
    "Return JSON: {\"intro\":\"2 sentences\",\"blurbs\":[{\"id\":\"...\",\"blurb\":\"2-3 sentences\"}]}",
    "Use ONLY provided matchup facts (opp, SOS rank, lean). No FAAB. No invented injuries.",
    "Tone: decisive start/sit desk.",
  ].join("\n");
  const user = `Week ${pack.week} ${pack.season} start/sit board:\n${JSON.stringify(pack.byPos)}`;
  const raw = await groqJson(system, user);
  const map = parseBlurbs(raw, ids);
  const intro =
    raw && typeof raw === "object" && typeof (raw as { intro?: string }).intro === "string"
      ? String((raw as { intro: string }).intro).trim().slice(0, 400)
      : `Week ${pack.week} matchups create clear starts and sits across the lineup — here are the sharpest edges by position.`;

  const byPos: Record<string, DeskPlayerBlurb[]> = {};
  for (const [pos, rows] of Object.entries(templates)) {
    byPos[pos] = rows.map((p) => ({
      ...p,
      blurb: map.get(p.id) || p.blurb,
    }));
  }
  return {
    intro:
      intro ||
      `Week ${pack.week} matchups create clear starts and sits across the lineup — here are the sharpest edges by position.`,
    byPos,
  };
}
