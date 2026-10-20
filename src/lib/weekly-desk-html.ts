/**
 * Pure HTML builders for weekly desk player breaks (hero + list rows).
 * Styled via ArticleView CSS hooks (.lo-player-hero / .lo-player-row).
 */

export type DeskPlayerBlurb = {
  id: string;
  name: string;
  pos: string;
  team: string;
  blurb: string;
  meta?: string;
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

function playerHeadHtml(player: DeskPlayerBlurb): string {
  const src = headshotUrl(player.id, player.pos, player.team);
  const label = [player.pos, player.team].filter(Boolean).join(" · ");
  return (
    `<a href="/player/${escapeHtml(player.id)}" style="display:flex;align-items:center;gap:0.85rem;text-decoration:none;color:inherit">` +
    `<img src="${escapeHtml(src)}" alt="" width="64" height="64" />` +
    `<span><strong style="display:block;font-size:1.05rem">${escapeHtml(player.name)}</strong>` +
    `<span style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#2563eb">${escapeHtml(label)}</span>` +
    (player.meta
      ? `<span style="display:block;margin-top:0.2rem;font-size:0.75rem;color:#64748b">${escapeHtml(player.meta)}</span>`
      : "") +
    `</span></a>`
  );
}

export function renderPlayerHeroBlock(player: DeskPlayerBlurb): string {
  return (
    `<div class="lo-player-hero">` +
    `<div class="lo-player-hero__head">${playerHeadHtml(player)}</div>` +
    `<div class="lo-player-hero__body"><p>${escapeHtml(player.blurb)}</p></div>` +
    `</div>`
  );
}

export function renderPlayerRowBlock(player: DeskPlayerBlurb): string {
  const src = headshotUrl(player.id, player.pos, player.team);
  const label = [player.pos, player.team].filter(Boolean).join(" · ");
  return (
    `<div class="lo-player-row">` +
    `<a href="/player/${escapeHtml(player.id)}"><img src="${escapeHtml(src)}" alt="" width="44" height="44" /></a>` +
    `<div class="lo-player-row__copy">` +
    `<p><a href="/player/${escapeHtml(player.id)}"><strong>${escapeHtml(player.name)}</strong></a>` +
    ` <span style="font-size:0.7rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#64748b">${escapeHtml(label)}</span></p>` +
    (player.meta
      ? `<p style="font-size:0.75rem;color:#64748b;margin-bottom:0.25rem">${escapeHtml(player.meta)}</p>`
      : "") +
    `<p>${escapeHtml(player.blurb)}</p>` +
    `</div></div>`
  );
}

/** First player = hero break; remaining = list rows. */
export function renderPositionSection(
  heading: string,
  players: DeskPlayerBlurb[],
): string {
  if (!players.length) return "";
  const [hero, ...rest] = players;
  const parts = [`<h2>${escapeHtml(heading)}</h2>`, renderPlayerHeroBlock(hero!)];
  for (const row of rest) parts.push(renderPlayerRowBlock(row));
  return parts.join("\n");
}

export function wrapDeskArticle(introHtml: string, sectionsHtml: string[]): string {
  return [`<p>${escapeHtml(introHtml)}</p>`, ...sectionsHtml].filter(Boolean).join("\n");
}
