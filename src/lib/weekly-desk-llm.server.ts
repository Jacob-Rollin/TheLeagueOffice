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
    board[pos] = rows.map((p) => {
      const oppRankVsPos = p.sosRank;
      // Board: 1 = toughest defense vs this position, 32 = softest / worst vs this position.
      let defenseStanding: string;
      if (oppRankVsPos >= 32) defenseStanding = `worst defense vs ${p.pos} so far this season`;
      else if (oppRankVsPos >= 30) defenseStanding = `one of the softest defenses vs ${p.pos} so far this season`;
      else if (oppRankVsPos >= 25) defenseStanding = `below-average defense vs ${p.pos} through the season to date`;
      else if (oppRankVsPos <= 1) defenseStanding = `toughest defense vs ${p.pos} so far this season`;
      else if (oppRankVsPos <= 3) defenseStanding = `one of the stingiest defenses vs ${p.pos} so far this season`;
      else if (oppRankVsPos <= 8) defenseStanding = `top-tier defense vs ${p.pos} through the season to date`;
      else defenseStanding = `middle-of-the-pack defense vs ${p.pos} so far this season`;

      return {
        id: p.id,
        name: p.name,
        pos: p.pos,
        team: p.team,
        opp: p.opp,
        oppNickname: p.oppNickname,
        lean: p.lean,
        /** Opponent's defensive rank against this position (1 = toughest, 32 = softest). */
        oppRankVsPos,
        defenseStanding,
        oppPointsAllowedToPos: p.oppPointsAllowed,
        note:
          p.oppPointsAllowed == null
            ? `Cite defenseStanding / oppRankVsPos only — no invented FPPG.`
            : `${p.oppNickname || p.opp} have allowed ${p.oppPointsAllowed} FPPG to ${p.pos}`,
      };
    });
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
    "ALWAYS frame the matchup around the opposing DEFENSE vs this player's POSITION.",
    "Use defenseStanding and oppRankVsPos (1 = toughest defense vs that position, 32 = worst/softest).",
    "Example good phrasing: \"Detroit has been the worst defense against quarterbacks so far this season…\"",
    "Example good phrasing: \"Buffalo rank among the stingiest defenses against running backs through the season to date…\"",
    "NEVER write \"SOS rank\", \"SOS\", \"marked Favorable\", \"marked Tough\", or \"Favorable matchup\" as a label.",
    "When oppPointsAllowedToPos is a number, cite it as FPPG allowed to that position.",
    "If points-allowed is null, rely on defenseStanding / oppRankVsPos only.",
    "Every listed player is already a depth-chart starter — do not frame them as handcuffs.",
    "Do not invent ownership language. The header already shows START/SIT · vs · Opp rank vs POS.",
    "Tone: decisive start/sit desk centered on how that defense has treated this position.",
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
    `Week ${pack.week} starts and sits hinge on how each defense has treated that position so far — here are the clearest edges.`;

  const byPos: Record<string, DeskPlayerBlurb[]> = {};
  for (const [pos, rows] of Object.entries(templates)) {
    byPos[pos] = rows.map((p) => ({
      ...p,
      blurb: sanitizeDeskBlurb(map.get(p.id) || p.blurb),
    }));
  }
  return { intro, byPos };
}
