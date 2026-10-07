/**
 * Public snap CDN base for research/snap JSON (no Fluid / TiDB on hit).
 *
 * Preferred (no card): GitHub `snap-cdn` branch via
 *   VITE_SNAP_CDN_BASE=https://raw.githubusercontent.com/<owner>/<repo>/snap-cdn
 *
 * Legacy alias: VITE_R2_PUBLIC_BASE (Cloudflare R2) still works if set.
 * Empty = CDN disabled; clients use /api/data/*.
 */

function readPublicBase(): string {
  try {
    const snap = String(import.meta.env["VITE_SNAP_CDN_BASE"] ?? "").trim();
    const r2 = String(import.meta.env["VITE_R2_PUBLIC_BASE"] ?? "").trim();
    return (snap || r2).replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function r2PublicBase(): string {
  return readPublicBase();
}

export function snapCdnPublicBase(): string {
  return readPublicBase();
}

export function r2Url(path: string): string | null {
  const base = readPublicBase();
  if (!base) return null;
  const clean = path.replace(/^\//, "");
  return `${base}/${clean}`;
}

/** Stable object keys for research aggregates published by Actions → snap-cdn. */
export const R2_RESEARCH_KEYS = {
  fpa: (format: string) => `research/fpa-${format}.json`,
  matchupsGuide: (week: number, format: string) => `research/matchups-guide-w${week}-${format}.json`,
  sosAnalysis: (format: string) => `research/sos-analysis-${format}.json`,
  fantasyLeaders: () => `research/fantasy-leaders.json`,
  sosBoard: () => `research/sos-board.json`,
  redzone: (yardline: number) => `research/redzone-${yardline}.json`,
  targets: () => `research/targets.json`,
  areTheyPlaying: (week: number) => `research/are-they-playing-w${week}.json`,
} as const;

export const R2_SNAP_KEYS = {
  tradeMarket: (format: string) => `snap/trade-market-${format}.json`,
  injuryReports: () => `snap/injury-reports.json`,
  fantasyNews: () => `snap/fantasy-news.json`,
  tradeBasis: () => `snap/trade-basis.json`,
} as const;
