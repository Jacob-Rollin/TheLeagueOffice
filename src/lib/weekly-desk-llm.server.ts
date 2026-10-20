/**
 * Groq narration for weekly Front Office desks. Facts only — no FAAB, no invented stats.
 */
import { sanitizeDeskBlurb, type DeskPlayerBlurb } from "@/lib/weekly-desk-html";
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
    if (id && text) map.set(id, sanitizeDeskBlurb(text).slice(0, 700));
  }
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
      temperature: 0.7,
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

function waiverFactsForLlm(pack: WaiverDeskPack) {
  return {
    week: pack.week,
    season: pack.season,
    players: pack.players.map((p) => ({
      id: p.id,
      name: p.name,
      pos: p.pos,
      team: p.team,
      nextOpponent: p.nextOpponent,
      rosteredPct: `${p.owned}%`,
      rosteredLabel: `rostered in ${p.owned}% of fantasy leagues`,
      trendAdds: p.trendCount,
      role: p.role,
      depthOrder: p.depthOrder,
    })),
  };
}

function startSitFactsForLlm(pack: StartSitDeskPack) {
  const board: Record<string, unknown[]> = {};
  for (const [pos, rows] of Object.entries(pack.byPos)) {
    board[pos] = rows.map((p) => ({
      id: p.id,
      name: p.name,
      pos: p.pos,
      team: p.team,
      opp: p.opp,
      oppNickname: p.oppNickname,
      lean: p.lean,
      sosRank: p.sosRank,
      grade: p.grade,
      /** Season fantasy points per game this opponent has allowed to this position. */
      oppPointsAllowedToPos: p.oppPointsAllowed,
      note:
        p.oppPointsAllowed == null
          ? "points-allowed unavailable — use SOS rank/grade only"
          : `Opponent has allowed ${p.oppPointsAllowed} FPPG to ${p.pos}`,
    }));
  }
  return { week: pack.week, season: pack.season, byPos: board };
}

export async function narrateWaiverBlurbs(
  pack: WaiverDeskPack,
  templates: DeskPlayerBlurb[],
): Promise<{ intro: string; players: DeskPlayerBlurb[] }> {
  const ids = templates.map((p) => p.id);
  const system = [
    "You write League Office waiver-wire blurbs for fantasy football in the style of an NFL.com fantasy desk.",
    "Return JSON: {\"intro\":\"2-3 sentences\",\"blurbs\":[{\"id\":\"...\",\"blurb\":\"2-4 sentences\"}]}",
    "Use ONLY provided facts. No FAAB dollars. No invented injuries or stats.",
    "rosteredPct is the share of fantasy leagues that already roster the player (e.g. \"14%\").",
    "ALWAYS write ownership as \"X% rostered\" or \"rostered in X% of leagues\". NEVER say \"owners\".",
    "Do not repeat the ROSTERED line — that already appears under the player header.",
    "role=starter means depth-chart starter still available; role=injury-elevated means the starter is out and this backup's role grew.",
    "Tone: sharp sports desk, not template filler.",
  ].join("\n");
  const user = `Week ${pack.week} ${pack.season} waiver board:\n${JSON.stringify(waiverFactsForLlm(pack))}`;
  const raw = await groqJson(system, user);
  const map = parseBlurbs(raw, ids);
  const introRaw =
    raw && typeof raw === "object" && typeof (raw as { intro?: string }).intro === "string"
      ? String((raw as { intro: string }).intro).trim().slice(0, 500)
      : "";
  const intro =
    sanitizeDeskBlurb(introRaw) ||
    `Here are the priority adds to watch heading into Week ${pack.week} — focused on available players with clear roles and rising opportunity.`;

  return {
    intro,
    players: templates.map((p) => ({
      ...p,
      blurb: sanitizeDeskBlurb(map.get(p.id) || p.blurb),
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
    "You write League Office start/sit blurbs for fantasy football in the style of an NFL.com fantasy desk.",
    "Return JSON: {\"intro\":\"2-3 sentences\",\"blurbs\":[{\"id\":\"...\",\"blurb\":\"2-4 sentences\"}]}",
    "Use ONLY provided matchup facts. No FAAB. No invented injuries, yards, TDs, or percentages.",
    "When oppPointsAllowedToPos is a number, cite it as fantasy points per game allowed to that position (e.g. \"allowed 24.1 FPPG to WRs\").",
    "Combine SOS rank/grade with points-allowed when both exist — do not invent other defensive stats.",
    "If points-allowed is null, rely on SOS rank/grade only.",
    "Every listed player is already a depth-chart starter — do not frame them as handcuffs.",
    "Do not invent ownership language. The START/SIT · vs · SOS line already appears under the header.",
    "Tone: decisive start/sit desk with concrete matchup context.",
  ].join("\n");
  const user = `Week ${pack.week} ${pack.season} start/sit board:\n${JSON.stringify(startSitFactsForLlm(pack))}`;
  const raw = await groqJson(system, user);
  const map = parseBlurbs(raw, ids);
  const introRaw =
    raw && typeof raw === "object" && typeof (raw as { intro?: string }).intro === "string"
      ? String((raw as { intro: string }).intro).trim().slice(0, 500)
      : "";
  const intro =
    sanitizeDeskBlurb(introRaw) ||
    `Week ${pack.week} matchups create clear starts and sits — here are the sharpest edges by position, grounded in how each defense has treated that spot.`;

  const byPos: Record<string, DeskPlayerBlurb[]> = {};
  for (const [pos, rows] of Object.entries(templates)) {
    byPos[pos] = rows.map((p) => ({
      ...p,
      blurb: sanitizeDeskBlurb(map.get(p.id) || p.blurb),
    }));
  }
  return { intro, byPos };
}
