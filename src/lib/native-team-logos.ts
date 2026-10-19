/**
 * Curated native-league team logo pool.
 * Stored as short keys (`pool:helmet:navy`) in `native_teams.avatar_url`;
 * resolved client-side to data-URI SVGs (with team initial) so `<img>` works.
 *
 * Helmet artwork matches the mobile Team-tab lucide-lab football-helmet paths.
 */

export const NATIVE_LOGO_SHAPES = ["helmet", "shield", "ball", "star", "bolt"] as const;
export type NativeLogoShape = (typeof NATIVE_LOGO_SHAPES)[number];

/**
 * Picker palette — neutrals, cools, warms, then earth/greens.
 * Ids are stored in `pool:shape:id` keys.
 */
export const NATIVE_LOGO_COLORS = [
  { id: "black", fill: "#111827", ink: "#F8FAFC", label: "Black" },
  { id: "grey", fill: "#6B7280", ink: "#FFFFFF", label: "Grey" },
  { id: "navy", fill: "#0B1F3A", ink: "#F8FAFC", label: "Navy" },
  { id: "lightblue", fill: "#38BDF8", ink: "#0C4A6E", label: "Light blue" },
  { id: "purple", fill: "#6B21A8", ink: "#FAF5FF", label: "Purple" },
  { id: "maroon", fill: "#7F1D1D", ink: "#FEF2F2", label: "Maroon" },
  { id: "red", fill: "#C8102E", ink: "#FFFFFF", label: "Red" },
  { id: "orange", fill: "#EA580C", ink: "#FFF7ED", label: "Orange" },
  { id: "yellow", fill: "#EAB308", ink: "#1C1917", label: "Yellow" },
  { id: "brown", fill: "#78350F", ink: "#FFFBEB", label: "Brown" },
  { id: "green", fill: "#16A34A", ink: "#F0FDF4", label: "Green" },
  { id: "darkgreen", fill: "#14532D", ink: "#F0FDF4", label: "Dark green" },
] as const;

export type NativeLogoColorId = (typeof NATIVE_LOGO_COLORS)[number]["id"];

/** Pre-palette ids still resolve so existing `avatar_url` keys keep rendering. */
const LEGACY_LOGO_COLORS = [
  { id: "slate", fill: "#334155", ink: "#F8FAFC" },
  { id: "blue", fill: "#1D4ED8", ink: "#EFF6FF" },
  { id: "sky", fill: "#0284C7", ink: "#F0F9FF" },
  { id: "teal", fill: "#0F766E", ink: "#F0FDFA" },
  { id: "amber", fill: "#B45309", ink: "#FFFBEB" },
  { id: "charcoal", fill: "#1E293B", ink: "#F8FAFC" },
  { id: "crimson", fill: "#991B1B", ink: "#FEF2F2" },
  { id: "forest", fill: "#166534", ink: "#F0FDF4" },
] as const;

export type NativeLogoOption = {
  key: string;
  shape: NativeLogoShape;
  colorId: NativeLogoColorId;
  fill: string;
  ink: string;
  label: string;
};

type LogoColorSwatch = { id: string; fill: string; ink: string };

const COLOR_BY_ID = new Map<string, LogoColorSwatch>([
  ...NATIVE_LOGO_COLORS.map((c) => [c.id, { id: c.id, fill: c.fill, ink: c.ink }] as const),
  ...LEGACY_LOGO_COLORS.map((c) => [c.id, { id: c.id, fill: c.fill, ink: c.ink }] as const),
]);

const SHAPE_LABEL: Record<NativeLogoShape, string> = {
  helmet: "Helmet",
  shield: "Shield",
  ball: "Football",
  star: "Star",
  bolt: "Bolt",
};

/** Bolt is too narrow for a monogram — render glyph only. */
export function nativeLogoShowsLetter(shape: NativeLogoShape): boolean {
  return shape !== "bolt";
}

export function nativeLogoKey(shape: NativeLogoShape, colorId: NativeLogoColorId): string {
  return `pool:${shape}:${colorId}`;
}

const POOL_KEY_RE = /^pool:([a-z]+):([a-z]+)$/i;

export function parseNativeLogoKey(
  raw: string | null | undefined,
): { shape: NativeLogoShape; colorId: string } | null {
  const value = String(raw ?? "").trim();
  const match = POOL_KEY_RE.exec(value);
  if (!match) return null;
  const shape = match[1]!.toLowerCase() as NativeLogoShape;
  const colorId = match[2]!.toLowerCase();
  if (!NATIVE_LOGO_SHAPES.includes(shape)) return null;
  if (!COLOR_BY_ID.has(colorId)) return null;
  return { shape, colorId };
}

export function isNativeLogoKey(raw: string | null | undefined): boolean {
  return parseNativeLogoKey(raw) != null;
}

/** First alphanumeric from a team name, uppercased (fallback "T"). */
export function teamLogoInitial(name?: string | null): string {
  const cleaned = String(name ?? "").trim();
  const match = cleaned.match(/[A-Za-z0-9]/);
  return (match?.[0] ?? "T").toUpperCase();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type LetterSlot = { x: number; y: number; size: number };

/**
 * Monogram. `cutout` = disc color punched through a filled emblem;
 * `overlay` = ink letter on top of a stroke-only glyph (helmet).
 * Uses dy for reliable vertical centering across SVG renderers.
 */
function monogram(
  letter: string,
  color: string,
  slot: LetterSlot,
): string {
  const ch = escapeXml(letter.slice(0, 1).toUpperCase() || "T");
  return `<text x="${slot.x}" y="${slot.y}" dy="0.35em" text-anchor="middle" font-family="Archivo, Barlow Condensed, Arial Black, sans-serif" font-size="${slot.size}" font-weight="800" fill="${color}">${ch}</text>`;
}

/**
 * Lucide Lab football-helmet paths (24×24), scaled into the logo disc.
 * Same silhouette as the mobile Team tab icon.
 */
function helmetEmblem(ink: string): string {
  return [
    `<g transform="translate(8.5 8.5) scale(1.95)" fill="none" stroke="${ink}" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">`,
    `<path d="M7 14h.01"/>`,
    `<path d="M21.6 9c-1.3-4-5.1-7-9.6-7C6.5 2 2 6.5 2 12c0 2.6 1 5 3 7c1.4 1.3 3.6 1.4 4.9 0c.7-.7 1-1.6 1-2.5V13c0-1.7 1.3-3 3-3h6.8c.7 0 1-.4.9-1m.4 9H10.7"/>`,
    `<path d="M11 14h9a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2c-2.8 0-5-2.2-5-5v-3"/>`,
    `</g>`,
  ].join("");
}

/** Emblem paths sit on a solid team-color disc. */
function buildSvg(shape: NativeLogoShape, fill: string, ink: string, letter: string): string {
  const disc = `<circle cx="32" cy="32" r="30" fill="${fill}"/>`;
  let emblem = "";
  let letterMarkup = "";

  switch (shape) {
    case "helmet": {
      emblem = helmetEmblem(ink);
      // Letter on the shell (lucide ~8,10 → disc coords), above the earhole.
      if (letter) {
        letterMarkup = monogram(letter, ink, { x: 24.5, y: 28, size: 12 });
      }
      break;
    }
    case "shield": {
      emblem = `<path fill="${ink}" d="M32 7.5l20 6.2v14.8c0 14.2-8.5 23.8-20 27.5C20.5 52.3 12 42.7 12 28.5V13.7L32 7.5z"/>`;
      if (letter) letterMarkup = monogram(letter, fill, { x: 32, y: 28, size: 18 });
      break;
    }
    case "ball": {
      // Horizontal pointed football; tip stripes only — center clear for monogram.
      emblem = [
        `<path fill="${ink}" d="M4.5 32C8.5 19.5 19 12 32 12s23.5 7.5 27.5 20C55.5 44.5 45 52 32 52S8.5 44.5 4.5 32z"/>`,
        `<path fill="none" stroke="${fill}" stroke-width="2.3" stroke-linecap="round" d="M12.5 25c2.4 4.5 2.4 9.5 0 14"/>`,
        `<path fill="none" stroke="${fill}" stroke-width="2.3" stroke-linecap="round" d="M51.5 25c-2.4 4.5-2.4 9.5 0 14"/>`,
      ].join("");
      // Geometric center of the oval (32,32) with dy-based baseline centering.
      if (letter) letterMarkup = monogram(letter, fill, { x: 32, y: 32, size: 20 });
      break;
    }
    case "star": {
      emblem = `<path fill="${ink}" d="M32 4.7L38.58 24.14L59.11 24.39L42.65 36.66L48.75 56.26L32 44.4L15.25 56.26L21.35 36.66L4.89 24.39L25.42 24.14Z"/>`;
      if (letter) letterMarkup = monogram(letter, fill, { x: 32, y: 33, size: 15 });
      break;
    }
    case "bolt": {
      // No monogram — bolt is too narrow; glyph alone.
      emblem = `<path fill="${ink}" d="M39 7.5L15.5 34h13L23.5 56.5 49 28.5H34.5L39 7.5z"/>`;
      break;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128">${disc}${emblem}${letterMarkup}</svg>`;
}

export function nativeLogoDataUri(
  key: string,
  initial?: string | null,
): string | null {
  const parsed = parseNativeLogoKey(key);
  if (!parsed) return null;
  const color = COLOR_BY_ID.get(parsed.colorId);
  if (!color) return null;
  const letter = nativeLogoShowsLetter(parsed.shape) ? teamLogoInitial(initial) : "";
  const svg = buildSvg(parsed.shape, color.fill, color.ink, letter);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function resolveNativeTeamAvatarSrc(
  raw?: string | null,
  initial?: string | null,
): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (isNativeLogoKey(value)) return nativeLogoDataUri(value, initial);
  return value;
}

export const NATIVE_LOGO_POOL: NativeLogoOption[] = NATIVE_LOGO_SHAPES.flatMap((shape) =>
  NATIVE_LOGO_COLORS.map((color) => ({
    key: nativeLogoKey(shape, color.id),
    shape,
    colorId: color.id,
    fill: color.fill,
    ink: color.ink,
    label: `${SHAPE_LABEL[shape]} · ${color.label}`,
  })),
);

const POOL_KEY_SET = new Set(NATIVE_LOGO_POOL.map((o) => o.key));

export function isAllowedNativeLogoKey(raw: string | null | undefined): boolean {
  const value = String(raw ?? "").trim();
  return POOL_KEY_SET.has(value);
}

/** Deterministic distinct logos for N seats (creation defaults). */
export function pickDistinctNativeLogos(count: number): string[] {
  const n = Math.max(0, Math.floor(count));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const shape = NATIVE_LOGO_SHAPES[i % NATIVE_LOGO_SHAPES.length]!;
    const color = NATIVE_LOGO_COLORS[i % NATIVE_LOGO_COLORS.length]!;
    out.push(nativeLogoKey(shape, color.id));
  }
  return out;
}
