/**
 * Pure HTML builders for weekly desk player breaks — NFL Fantasy-style headers.
 *
 * Boxed chip: headshot + name + "POS | TEAM"
 * Below the box (bold, not linked): ROSTERED / START · vs · Opp rank vs POS
 * Then normal article prose.
 * Player links use data-player-id so ArticleView can open the player popup.
 */

export type DeskPlayerBlurb = {
  id: string;
  name: string;
  pos: string;
  team: string;
  blurb: string;
  /** Bold line under the boxed header — e.g. "ROSTERED: 14%" or "START · vs DET · Opp rank vs QB: 32". */
  statLine?: string;
  /** Nickname team for priority table (e.g. Steelers). */
  teamNickname?: string;
  /** Next-opponent cell for the waiver priority table (e.g. "vs. Saints"). */
  nextOpponent?: string;
};

const POS_HEADINGS: Record<string, string> = {
  QB: "Quarterbacks",
  RB: "Running Backs",
  WR: "Wide Receivers",
  TE: "Tight Ends",
  DST: "DST",
  DEF: "DST",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function headshotUrl(id: string, pos: string, team: string): string {
  const p = pos.toUpperCase();
  if (p === "DEF" || p === "DST") {
    const t = (team || id).toLowerCase();
    return `https://sleepercdn.com/images/team_logos/nfl/${t}.png`;
  }
  return `https://sleepercdn.com/content/nfl/players/${id}.jpg`;
}

function normPos(pos: string): string {
  const p = String(pos || "").toUpperCase();
  return p === "DEF" ? "DST" : p;
}

function playerHref(id: string): string {
  return `/player/${escapeHtml(id)}`;
}

/** Rewrite ambiguous ownership / SOS phrasing the LLM sometimes invents. */
export function sanitizeDeskBlurb(text: string): string {
  return text
    .replace(/\bat\s+(\d{1,3})\s+owners?\b/gi, "at $1% rostered")
    .replace(/\b(\d{1,3})\s+owners?\b/gi, "$1% rostered")
    .replace(/\bowned\s+by\s+(\d{1,3})\s*%?\b/gi, "rostered in $1% of leagues")
    .replace(/\bownership\s+of\s+(\d{1,3})\b(?!\s*%)/gi, "rostered rate of $1%")
    .replace(/\brostered\s+in\s+(\d{1,3})\s+leagues\b/gi, "rostered in $1% of leagues")
    .replace(/\bSOS\s*rank(?:\s+of)?\s+(\d{1,2})\s+is\s+marked\s+Favorable\b/gi, "opp rank vs position of $1 points to a soft defense")
    .replace(/\bSOS\s*rank(?:\s+of)?\s+(\d{1,2})\s+is\s+marked\s+Tough\b/gi, "opp rank vs position of $1 points to a tough defense")
    .replace(/\bmarked\s+Favorable\b/gi, "a soft matchup against that position")
    .replace(/\bmarked\s+Tough\b/gi, "a tough matchup against that position")
    .replace(/\bSOS\s*rank\b/gi, "opp rank vs position")
    .replace(/\b\(SOS[^)]*\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Content-width header chip: circular headshot + name + "POS | TEAM".
 * Stat line is NOT inside the box — use renderPlayerMetaHtml / renderPlayerBlock.
 */
export function renderPlayerHeaderHtml(player: {
  id: string;
  name: string;
  pos: string;
  team: string;
}): string {
  const src = headshotUrl(player.id, player.pos, player.team);
  const pos = normPos(player.pos);
  const team = (player.team || "").toUpperCase();
  const sub = [pos, team].filter(Boolean).join(" | ");
  return (
    `<div class="lo-player-header" contenteditable="false" ` +
    `style="display:inline-block;width:fit-content;max-width:18rem;vertical-align:top">` +
    `<a class="lo-player-header__inner lo-player-link" href="${playerHref(player.id)}" ` +
    `data-player-id="${escapeHtml(player.id)}" ` +
    `style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem 1rem;text-decoration:none;color:inherit">` +
    `<img class="lo-player-header__shot" src="${escapeHtml(src)}" alt="" width="56" height="56" ` +
    `style="width:56px;height:56px;border-radius:9999px;object-fit:cover;flex-shrink:0;margin:0;` +
    `border:2px solid #cbd5e1;background:#e2e8f0" />` +
    `<span class="lo-player-header__id" style="display:flex;flex-direction:column;gap:0.2rem;min-width:0">` +
    `<strong class="lo-player-header__name" style="display:block;font-size:1.25rem;line-height:1.2;color:#0f172a">` +
    `${escapeHtml(player.name)}</strong>` +
    (sub
      ? `<span class="lo-player-header__sub" style="display:block;font-size:0.8rem;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#64748b">` +
        `${escapeHtml(sub)}</span>`
      : "") +
    `</span></a></div>`
  );
}

/** Bold metadata line under the header box (not linked, not inside the chip). */
export function renderPlayerMetaHtml(statLine: string | null | undefined): string {
  const stat = String(statLine ?? "").trim();
  if (!stat) return "";
  return (
    `<p class="lo-player-meta" style="margin:0.35rem 0 0.75rem;font-size:0.875rem;font-weight:700;` +
    `letter-spacing:0.04em;text-transform:uppercase;color:#0f172a">` +
    `<strong>${escapeHtml(stat)}</strong></p>`
  );
}

/**
 * Full player unit for generated articles:
 * boxed header → bold meta under it → article paragraph.
 */
export function renderPlayerBlock(player: DeskPlayerBlurb): string {
  const blurb = sanitizeDeskBlurb(player.blurb);
  return (
    `${renderPlayerHeaderHtml(player)}\n` +
    `${renderPlayerMetaHtml(player.statLine)}\n` +
    `<p>${escapeHtml(blurb)}</p>`
  );
}

/**
 * NFL.com-style two-column priority board:
 * WAIVER WIRE PRIORITY RANKINGS | NEXT OPPONENT
 */
export function renderPriorityList(
  heading: string,
  players: DeskPlayerBlurb[],
): string {
  if (!players.length) return "";
  const rows = players
    .map((p, i) => {
      const pos = normPos(p.pos);
      const nick = (p.teamNickname || p.team || "").trim();
      const left = `${i + 1}) ${pos} ${p.name}${nick ? `, ${nick}` : ""}`;
      const opp = (p.nextOpponent || "TBD").trim();
      return (
        `<tr>` +
        `<td><a class="lo-player-link" href="${playerHref(p.id)}" data-player-id="${escapeHtml(p.id)}">` +
        `${escapeHtml(left)}</a></td>` +
        `<td>${escapeHtml(opp)}</td>` +
        `</tr>`
      );
    })
    .join("");
  return (
    `<div class="lo-priority">` +
    `<h2>${escapeHtml(heading)}</h2>` +
    `<div class="lo-priority__wrap">` +
    `<table class="lo-priority__table">` +
    `<thead><tr>` +
    `<th scope="col">Waiver Wire Priority Rankings</th>` +
    `<th scope="col">Next Opponent</th>` +
    `</tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table></div></div>`
  );
}

/** Position section: heading + uniform player blocks. */
export function renderPositionSection(
  heading: string,
  players: DeskPlayerBlurb[],
): string {
  if (!players.length) return "";
  const title = POS_HEADINGS[heading.toUpperCase()] ?? heading;
  const parts = [`<h2>${escapeHtml(title)}</h2>`];
  for (const row of players) parts.push(renderPlayerBlock(row));
  return parts.join("\n");
}

/** Group blurbs into NFL-style position sections in QB→RB→WR→TE→DST order. */
export function renderGroupedByPosition(players: DeskPlayerBlurb[]): string[] {
  const order = ["QB", "RB", "WR", "TE", "DST"] as const;
  const buckets = new Map<string, DeskPlayerBlurb[]>();
  for (const p of players) {
    const key = normPos(p.pos);
    const list = buckets.get(key) ?? [];
    list.push(p);
    buckets.set(key, list);
  }
  const sections: string[] = [];
  for (const pos of order) {
    const rows = buckets.get(pos);
    if (rows?.length) sections.push(renderPositionSection(pos, rows));
  }
  for (const [pos, rows] of buckets) {
    if ((order as readonly string[]).includes(pos)) continue;
    if (rows.length) sections.push(renderPositionSection(pos, rows));
  }
  return sections;
}

export function wrapDeskArticle(introHtml: string, sectionsHtml: string[]): string {
  const intro = sanitizeDeskBlurb(introHtml);
  return [`<p>${escapeHtml(intro)}</p>`, ...sectionsHtml].filter(Boolean).join("\n");
}

/** @deprecated Prefer renderPlayerBlock. */
export function renderPlayerHeroBlock(player: DeskPlayerBlurb): string {
  return renderPlayerBlock(player);
}

/** @deprecated Prefer renderPlayerBlock. */
export function renderPlayerRowBlock(player: DeskPlayerBlurb): string {
  return renderPlayerBlock(player);
}
