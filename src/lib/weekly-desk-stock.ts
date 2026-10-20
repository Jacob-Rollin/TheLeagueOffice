/**
 * Curated free landscape football stock URLs (Unsplash) for article heroes.
 * Cropped toward 16:9 via Unsplash query params — still editable as plain URLs.
 */

const STOCK = [
  "https://images.unsplash.com/photo-1566577739112-516b133cfc6b?auto=format&fit=crop&w=1600&h=900&q=80",
  "https://images.unsplash.com/photo-1459865264687-595d652de67e?auto=format&fit=crop&w=1600&h=900&q=80",
  "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=1600&h=900&q=80",
  "https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=1600&h=900&q=80",
  "https://images.unsplash.com/photo-1489944440615-453fc2b6a9a9?auto=format&fit=crop&w=1600&h=900&q=80",
  "https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?auto=format&fit=crop&w=1600&h=900&q=80",
  "https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=1600&h=900&q=80",
  "https://images.unsplash.com/photo-1612872087720-bb876e2e67d1?auto=format&fit=crop&w=1600&h=900&q=80",
] as const;

export type WeeklyDeskKind = "waiver" | "start-sit";

/** Deterministic stock hero for a desk kind + week (rotates through the pool). */
export function weeklyDeskStockImage(kind: WeeklyDeskKind, week: number, season: number): string {
  const seed = kind === "waiver" ? week * 2 : week * 2 + 1;
  const idx = Math.abs(seed + season) % STOCK.length;
  return STOCK[idx]!;
}
