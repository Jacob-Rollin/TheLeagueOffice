/**
 * Curated free landscape American football stock URLs for article heroes.
 * Visually verified gridiron / stadium scenes only (no soccer, volleyball, etc.).
 * Cropped toward 16:9 via query params — still editable as plain URLs in the CMS.
 */

const STOCK = [
  // American football on turf (Pexels)
  "https://images.pexels.com/photos/2570139/pexels-photo-2570139.jpeg?auto=compress&cs=tinysrgb&w=1600&h=900&fit=crop",
  // Line of scrimmage (Pexels)
  "https://images.pexels.com/photos/1618200/pexels-photo-1618200.jpeg?auto=compress&cs=tinysrgb&w=1600&h=900&fit=crop",
  // Night runner with ball under stadium lights (Pexels)
  "https://images.pexels.com/photos/159515/football-american-football-runner-player-159515.jpeg?auto=compress&cs=tinysrgb&w=1600&h=900&fit=crop",
  // Ball carrier chase — daytime gridiron (Pexels)
  "https://images.pexels.com/photos/1618269/pexels-photo-1618269.jpeg?auto=compress&cs=tinysrgb&w=1600&h=900&fit=crop",
  // Offensive line under stadium floodlights (Pixabay)
  "https://cdn.pixabay.com/photo/2016/11/29/03/53/american-football-1867185_1280.jpg",
] as const;

export type WeeklyDeskKind = "waiver" | "start-sit";

/** Deterministic stock hero for a desk kind + week (rotates through the pool). */
export function weeklyDeskStockImage(kind: WeeklyDeskKind, week: number, season: number): string {
  const seed = kind === "waiver" ? week * 2 : week * 2 + 1;
  const idx = Math.abs(seed + season) % STOCK.length;
  return STOCK[idx]!;
}
