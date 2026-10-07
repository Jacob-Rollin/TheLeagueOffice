/**
 * Public Cloudflare R2 base for research/snap JSON.
 * Set VITE_R2_PUBLIC_BASE at build time (e.g. https://cdn.theleagueoffice.app
 * or https://pub-xxxxx.r2.dev). Empty = R2 disabled; clients use /api/data/*.
 */

export function r2PublicBase(): string {
  try {
    const raw = String(import.meta.env["VITE_R2_PUBLIC_BASE"] ?? "").trim().replace(/\/$/, "");
    return raw;
  } catch {
    return "";
  }
}

export function r2Url(path: string): string | null {
  const base = r2PublicBase();
  if (!base) return null;
  const clean = path.replace(/^\//, "");
  return `${base}/${clean}`;
}

/** Stable object keys for research aggregates published by Actions → R2. */
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
