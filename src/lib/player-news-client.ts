/**
 * Player news: CDN snaps first, then browser ESPN (visitor IP) when the
 * shared feed has nothing for this player. Avoids per-player Fluid fan-out.
 */

import { getCached, readCache } from "@/lib/sleeper-cache";
import { fetchSnapFantasyNews, fetchSnapInjuryReports } from "@/lib/snap-cdn";
import { resolveInjuryStatus } from "@/lib/sandbox-rosters";
import type { NewsItem } from "@/lib/players.server";
import type { PlayersPayload } from "@/lib/players-build";

export type PlayerNewsClient = {
  injury: { status: string | null; note: string | null };
  items: NewsItem[];
};

const CATALOG_KEY = "players-v3";
const HOUR = 60 * 60 * 1000;

function allowFluidFallback(): boolean {
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}

type CatalogPlayer = {
  id: string;
  name: string;
  team: string;
  pos: string;
  injury?: string | null;
  injury_status?: string | null;
  injury_body_part?: string | null;
  injury_notes?: string | null;
};

async function catalogPlayer(id: string): Promise<CatalogPlayer | null> {
  const hit = await readCache<PlayersPayload>(CATALOG_KEY);
  const player = hit?.data?.players?.find((p) => p.id === id);
  if (!player) return null;
  return player;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lastNameOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function playerNameRegex(name: string): RegExp {
  const base = name.replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/i, "").trim();
  return new RegExp(`(^|[^a-z'-])${escapeRegExp(base)}(?![a-z'-])`, "i");
}

function newsTextKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 80);
}

type EspnArticle = {
  id?: number | string;
  headline?: string;
  description?: string;
  published?: string;
  lastModified?: string;
  links?: { web?: { href?: string } };
  images?: { url?: string }[];
  categories?: { athlete?: { description?: string } }[];
};

type EspnFeedItem = {
  id?: number | string;
  type?: string;
  headline?: string;
  description?: string;
  story?: string;
  published?: string;
  lastModified?: string;
  links?: { web?: { href?: string } };
};

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function espnAthleteIdClient(name: string): Promise<string | null> {
  const key = `espn-athlete-id-v1:${name.toLowerCase()}`;
  return getCached(key, 24 * HOUR, async () => {
    const json = await fetchJson<{
      results?: { type?: string; contents?: { uid?: string; displayName?: string }[] }[];
    }>(
      `https://site.web.api.espn.com/apis/search/v2?query=${encodeURIComponent(name)}&limit=5&sport=football&league=nfl`,
    );
    const players = json?.results?.find((r) => r.type === "player")?.contents ?? [];
    const hit =
      players.find((c) => (c.displayName ?? "").toLowerCase() === name.toLowerCase()) ?? players[0];
    const m = /a:(\d+)/.exec(hit?.uid ?? "");
    if (!m?.[1]) throw new Error("espn athlete not found");
    return m[1];
  }).catch(() => null);
}

async function espnPlayerFeedClient(athleteId: string): Promise<EspnFeedItem[]> {
  const json = await fetchJson<{ feed?: EspnFeedItem[] }>(
    `https://site.web.api.espn.com/apis/fantasy/v2/games/ffl/news/players?playerId=${encodeURIComponent(athleteId)}&limit=15`,
  );
  return Array.isArray(json?.feed) ? json.feed : [];
}

async function espnNewsClient(query = ""): Promise<EspnArticle[]> {
  const json = await fetchJson<{ articles?: EspnArticle[] }>(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50${query}`,
  );
  return Array.isArray(json?.articles) ? json.articles : [];
}

function blurbTitle(name: string, blurb: string): string {
  const tagged = new RegExp(`\\b${escapeRegExp(lastNameOf(name))} \\(([a-z][a-z /-]{2,24})\\)`, "i").exec(
    blurb,
  );
  const who = tagged ? `${name} (${tagged[1]!.toLowerCase()})` : name;
  if (/\bpractic/i.test(blurb)) return `${who} practice update`;
  if (/\b(?:completed|carries|rushed|caught|receptions?|targets?|catches)\b/i.test(blurb)) {
    return `${name} game recap`;
  }
  if (tagged || /\binjur|questionable|doubtful|\bout\b|\bir\b/i.test(blurb)) {
    return `${who} injury update`;
  }
  return `${name} news update`;
}

/** Assemble ESPN articles for one player in the browser (CORS-open endpoints). */
async function fetchEspnPlayerNewsBrowser(player: CatalogPlayer): Promise<NewsItem[]> {
  const nameRe = playerNameRegex(player.name);
  const lastNameRe = playerNameRegex(lastNameOf(player.name));
  const isDef = player.pos === "DEF";
  const hasTeam = Boolean(player.team && player.team !== "FA");

  const athleteId = isDef ? null : await espnAthleteIdClient(player.name);
  const [feed, league, team] = await Promise.all([
    athleteId ? espnPlayerFeedClient(athleteId).catch(() => [] as EspnFeedItem[]) : Promise.resolve([] as EspnFeedItem[]),
    espnNewsClient("").catch(() => [] as EspnArticle[]),
    hasTeam
      ? espnNewsClient(`&team=${player.team.toLowerCase()}`).catch(() => [] as EspnArticle[])
      : Promise.resolve([] as EspnArticle[]),
  ]);

  const items: NewsItem[] = [];
  const seenIds = new Set<string>();
  const seenText = new Set<string>();
  const push = (item: NewsItem, dedupeText: string = item.headline) => {
    const keys = [newsTextKey(dedupeText)].filter(Boolean);
    if (seenIds.has(item.id) || keys.some((k) => seenText.has(k))) return;
    seenIds.add(item.id);
    for (const k of keys) seenText.add(k);
    items.push(item);
  };

  for (const f of feed) {
    const raw = stripTags(f.headline ?? "");
    if (!raw) continue;
    const story = stripTags(f.story ?? f.description ?? "");
    const isBlurb = !f.type || f.type === "Rotowire";
    if (isBlurb) {
      if (!lastNameRe.test(`${raw} ${story}`)) continue;
      push(
        {
          id: String(f.id ?? raw),
          headline: blurbTitle(player.name, raw),
          description: story && story !== raw ? `${raw} ${story}` : raw,
          published: f.published ?? f.lastModified ?? "",
          link: f.links?.web?.href ?? null,
          image: null,
          aboutPlayer: true,
          source: "RotoWire",
        },
        raw.replace(/\.$/, ""),
      );
      continue;
    }
    if (!nameRe.test(raw)) continue;
    push({
      id: String(f.id ?? raw),
      headline: raw,
      description: story,
      published: f.published ?? f.lastModified ?? "",
      link: f.links?.web?.href ?? null,
      image: null,
      aboutPlayer: true,
      source: "ESPN",
    });
  }

  for (const a of [...team, ...league]) {
    const headline = (a.headline ?? "").trim();
    if (!headline) continue;
    const athleteName =
      (a.categories ?? []).find((c) => (c.athlete?.description ?? "").trim())?.athlete?.description ??
      "";
    const blob = `${headline} ${a.description ?? ""} ${athleteName}`;
    if (!nameRe.test(blob) && !lastNameRe.test(blob)) continue;
    push({
      id: String(a.id ?? headline),
      headline,
      description: (a.description ?? "").trim(),
      published: a.published ?? a.lastModified ?? "",
      link: a.links?.web?.href ?? null,
      image: a.images?.[0]?.url ?? null,
      aboutPlayer: true,
      source: "ESPN",
    });
  }

  const time = (iso: string) => (iso ? Date.parse(iso) || 0 : 0);
  return items.sort((a, b) => time(b.published) - time(a.published)).slice(0, 20);
}

/** CDN-first player news; browser ESPN when snaps miss this player; Fluid only in DEV. */
export async function fetchPlayerNewsClient(id: string): Promise<PlayerNewsClient> {
  const playerId = String(id ?? "").slice(0, 32);
  if (!playerId) return { injury: { status: null, note: null }, items: [] };

  const catalog = await catalogPlayer(playerId).catch(() => null);
  const catalogStatus = catalog ? resolveInjuryStatus(catalog) ?? null : null;
  const catalogNote = catalog?.injury_notes?.trim() || catalog?.injury_body_part?.trim() || null;

  if (typeof window !== "undefined") {
    const [feed, reports] = await Promise.all([
      fetchSnapFantasyNews(80),
      fetchSnapInjuryReports(),
    ]);

    const report = (reports?.items ?? []).find((r) => r.sleeperId === playerId) ?? null;
    const items: NewsItem[] = [];
    const seen = new Set<string>();

    if (report) {
      items.push({
        id: `injury-${report.id}`,
        headline: report.headline,
        description: report.news || report.analysis || "",
        published: report.published,
        link: report.link,
        image: report.headshot,
        aboutPlayer: true,
        source: report.source,
      });
      seen.add(`injury-${report.id}`);
    }

    for (const row of feed ?? []) {
      if (row.player?.id !== playerId) continue;
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      items.push({
        id: row.id,
        headline: row.headline,
        description: row.body || "",
        published: row.published ?? "",
        link: row.link,
        image: row.image,
        aboutPlayer: true,
        source: row.source,
      });
    }

    // Shared league feed only covers hot players — fill from ESPN in the browser.
    if (!items.length && catalog) {
      const espnItems = await fetchEspnPlayerNewsBrowser(catalog).catch(() => [] as NewsItem[]);
      for (const item of espnItems) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
      }
    }

    const injuryStatus = report?.status ?? catalogStatus;
    const injuryNote = report?.news ?? catalogNote;

    if (items.length || injuryStatus || !allowFluidFallback()) {
      return {
        injury: {
          status: injuryStatus,
          note: injuryNote,
        },
        items,
      };
    }
  }

  const { getPlayerNews } = await import("./players.functions");
  const full = await getPlayerNews({ data: { id: playerId } });
  return {
    injury: {
      status: full?.injury?.status ?? catalogStatus,
      note: full?.injury?.note ?? catalogNote,
    },
    items: full?.items ?? [],
  };
}
