/**
 * Pure HTML builders for weekly desk player breaks — NFL Fantasy-style headers.
 * Name / TEAM / ROSTERED (or START·vs·SOS) then prose. Styled via ArticleView.
 */

export type DeskPlayerBlurb = {
  id: string;
  name: string;
  pos: string;
  team: string;
  blurb: string;
  /** Line under team abbr — e.g. "ROSTERED: 14%" or "START · vs KC · SOS 28". */
  statLine?: string;
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

/** Rewrite ambiguous ownership phrasing the LLM sometimes invents. */
export function sanitizeDeskBlurb(text: string): string {
  return text
    .replace(/\bat\s+(\d{1,3})\s+owners?\b/gi, "at $1% rostered")
    .replace(/\b(\d{1,3})\s+owners?\b/gi, "$1% rostered")
    .replace(/\bowned\s+by\s+(\d{1,3})\s*%?\b/gi, "rostered in $1% of leagues")
    .replace(/\bownership\s+of\s+(\d{1,3})\b(?!\s*%)/gi, "rostered rate of $1%")
    .replace(/\brostered\s+in\s+(\d{1,3})\s+leagues\b/gi, "rostered in $1% of leagues")
    .trim();
}

/** Single NFL-style player block: Name → TEAM → stat line → blurb. */
export function renderPlayerBlock(player: DeskPlayerBlurb): string {
  const src = headshotUrl(player.id, player.pos, player.team);
  const team = (player.team || "").toUpperCase();
  const stat = player.statLine?.trim();
  const blurb = sanitizeDeskBlurb(player.blurb);
  return (
    `<div class="lo-player-block">` +
    `<a class="lo-player-block__head" href="/player/${escapeHtml(player.id)}">` +
    `<img class="lo-player-block__shot" src="${escapeHtml(src)}" alt="" width="56" height="56" />` +
    `<span class="lo-player-block__id">` +
    `<strong class="lo-player-block__name">${escapeHtml(player.name)}</strong>` +
    (team ? `<span class="lo-player-block__team">${escapeHtml(team)}</span>` : "") +
    (stat ? `<span class="lo-player-block__stat">${escapeHtml(stat)}</span>` : "") +
    `</span></a>` +
    `<div class="lo-player-block__body"><p>${escapeHtml(blurb)}</p></div>` +
    `</div>`
  );
}

/** Numbered priority board (waiver top targets). */
export function renderPriorityList(
  heading: string,
  players: DeskPlayerBlurb[],
): string {
  if (!players.length) return "";
  const rows = players
    .map((p, i) => {
      const team = (p.team || "").toUpperCase();
      const label = [p.pos, team].filter(Boolean).join(" ");
      return (
        `<li><span class="lo-priority__rank">${i + 1})</span> ` +
        `<a href="/player/${escapeHtml(p.id)}"><strong>${escapeHtml(p.name)}</strong></a>` +
        (label ? `, ${escapeHtml(label)}` : "") +
        (p.statLine ? ` — ${escapeHtml(p.statLine)}` : "") +
        `</li>`
      );
    })
    .join("");
  return (
    `<div class="lo-priority">` +
    `<h2>${escapeHtml(heading)}</h2>` +
    `<ol class="lo-priority__list">${rows}</ol>` +
    `</div>`
  );
}

/** Position section: heading + uniform player blocks (no hero/list split). */
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
    const key = p.pos.toUpperCase() === "DEF" ? "DST" : p.pos.toUpperCase();
    const list = buckets.get(key) ?? [];
    list.push(p);
    buckets.set(key, list);
  }
  const sections: string[] = [];
  for (const pos of order) {
    const rows = buckets.get(pos);
    if (rows?.length) sections.push(renderPositionSection(pos, rows));
  }
  // Any unexpected positions last.
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

/** @deprecated Prefer renderPlayerBlock — kept for any leftover callers. */
export function renderPlayerHeroBlock(player: DeskPlayerBlurb): string {
  return renderPlayerBlock(player);
}

/** @deprecated Prefer renderPlayerBlock. */
export function renderPlayerRowBlock(player: DeskPlayerBlurb): string {
  return renderPlayerBlock(player);
}
