/**
 * Curated native-league team logo pool.
 * Stored as short keys (`pool:helmet:navy`) in `native_teams.avatar_url`;
 * resolved client-side to data-URI SVGs so `<img>` consumers work unchanged.
 */

export const NATIVE_LOGO_SHAPES = ["helmet", "shield", "ball", "star", "bolt"] as const;
export type NativeLogoShape = (typeof NATIVE_LOGO_SHAPES)[number];

export const NATIVE_LOGO_COLORS = [
  { id: "navy", fill: "#0B1F3A", ink: "#F8FAFC" },
  { id: "red", fill: "#C8102E", ink: "#FFFFFF" },
  { id: "slate", fill: "#334155", ink: "#F8FAFC" },
  { id: "blue", fill: "#1D4ED8", ink: "#EFF6FF" },
  { id: "sky", fill: "#0284C7", ink: "#F0F9FF" },
  { id: "teal", fill: "#0F766E", ink: "#F0FDFA" },
  { id: "green", fill: "#15803D", ink: "#F0FDF4" },
  { id: "amber", fill: "#B45309", ink: "#FFFBEB" },
  { id: "orange", fill: "#C2410C", ink: "#FFF7ED" },
  { id: "charcoal", fill: "#1E293B", ink: "#F8FAFC" },
  { id: "crimson", fill: "#991B1B", ink: "#FEF2F2" },
  { id: "forest", fill: "#166534", ink: "#F0FDF4" },
] as const;

export type NativeLogoColorId = (typeof NATIVE_LOGO_COLORS)[number]["id"];

export type NativeLogoOption = {
  key: string;
  shape: NativeLogoShape;
  colorId: NativeLogoColorId;
  fill: string;
  ink: string;
  label: string;
};

const COLOR_BY_ID = new Map(NATIVE_LOGO_COLORS.map((c) => [c.id, c]));

const SHAPE_LABEL: Record<NativeLogoShape, string> = {
  helmet: "Helmet",
  shield: "Shield",
  ball: "Football",
  star: "Star",
  bolt: "Bolt",
};

export function nativeLogoKey(shape: NativeLogoShape, colorId: NativeLogoColorId): string {
  return `pool:${shape}:${colorId}`;
}

const POOL_KEY_RE = /^pool:([a-z]+):([a-z]+)$/i;

export function parseNativeLogoKey(
  raw: string | null | undefined,
): { shape: NativeLogoShape; colorId: NativeLogoColorId } | null {
  const value = String(raw ?? "").trim();
  const match = POOL_KEY_RE.exec(value);
  if (!match) return null;
  const shape = match[1]!.toLowerCase() as NativeLogoShape;
  const colorId = match[2]!.toLowerCase() as NativeLogoColorId;
  if (!NATIVE_LOGO_SHAPES.includes(shape)) return null;
  if (!COLOR_BY_ID.has(colorId)) return null;
  return { shape, colorId };
}

export function isNativeLogoKey(raw: string | null | undefined): boolean {
  return parseNativeLogoKey(raw) != null;
}

/** Filled glyph on a colored disc; ball / helmet get simple accent strokes. */
function buildSvg(shape: NativeLogoShape, fill: string, ink: string): string {
  const disc = `<circle cx="32" cy="32" r="30" fill="${fill}"/>`;
  switch (shape) {
    case "helmet":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128">${disc}<path d="M14 34c0-11.6 9-21 20.5-21h5.5c6.6 0 12 5.2 12 11.6V27c0 1.1-.9 2-2 2H38c-3.9 0-7 3.1-7 7v5.5c0 2.1-1 4-2.6 5.2-2.2 1.7-5.3 1.4-7.1-.7C19.7 43.8 18 40.6 18 37.2V34z" fill="${ink}"/><path d="M31 42h16.5c1.9 0 3.5 1.6 3.5 3.5v4c0 1.9-1.6 3.5-3.5 3.5H28" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/><circle cx="20" cy="35.5" r="1.8" fill="${fill}"/></svg>`;
    case "shield":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128">${disc}<path d="M32 10l18 5.5v13.5c0 12.8-7.6 21.5-18 25-10.4-3.5-18-12.2-18-25V15.5L32 10z" fill="${ink}"/></svg>`;
    case "ball":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128">${disc}<ellipse cx="32" cy="32" rx="17" ry="21" fill="${ink}"/><path d="M32 15v34M25.5 24.5h13M25.5 39.5h13" fill="none" stroke="${fill}" stroke-width="2.4" stroke-linecap="round"/></svg>`;
    case "star":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128">${disc}<path d="M32 11l5.2 11.1 12.2 1.5-9 8.5 2.4 12.1L32 37.6 21.2 44.2l2.4-12.1-9-8.5 12.2-1.5L32 11z" fill="${ink}"/></svg>`;
    case "bolt":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128">${disc}<path d="M37 10L18 34h11.5L26 54l22-28H35.5L37 10z" fill="${ink}"/></svg>`;
  }
}

export function nativeLogoDataUri(key: string): string | null {
  const parsed = parseNativeLogoKey(key);
  if (!parsed) return null;
  const color = COLOR_BY_ID.get(parsed.colorId);
  if (!color) return null;
  const svg = buildSvg(parsed.shape, color.fill, color.ink);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function resolveNativeTeamAvatarSrc(raw?: string | null): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (isNativeLogoKey(value)) return nativeLogoDataUri(value);
  return value;
}

export const NATIVE_LOGO_POOL: NativeLogoOption[] = NATIVE_LOGO_SHAPES.flatMap((shape) =>
  NATIVE_LOGO_COLORS.map((color) => ({
    key: nativeLogoKey(shape, color.id),
    shape,
    colorId: color.id,
    fill: color.fill,
    ink: color.ink,
    label: `${SHAPE_LABEL[shape]} · ${color.id}`,
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
