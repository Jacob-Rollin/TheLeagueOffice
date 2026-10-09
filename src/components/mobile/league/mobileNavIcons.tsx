import { createLucideIcon } from "lucide-react";

/**
 * Horizontal American football — Matchup tab.
 * Larger, more open pointed shell so laces read at 20px.
 */
export const FootballIcon = createLucideIcon("football", [
  [
    "path",
    {
      // Pointed tips, taller midsection — fills the 24 box without feeling cramped.
      d: "M1.5 12C4 5.5 8 3.75 12 3.75S20 5.5 22.5 12C20 18.5 16 20.25 12 20.25S4 18.5 1.5 12z",
      key: "shell",
    },
  ],
  // Longer, more spaced lace stitches.
  ["path", { d: "M7.25 12h9.5", key: "lace-spine" }],
  ["path", { d: "M8.75 9.35v5.3", key: "lace-1" }],
  ["path", { d: "M10.9 9.35v5.3", key: "lace-2" }],
  ["path", { d: "M13.1 9.35v5.3", key: "lace-3" }],
  ["path", { d: "M15.25 9.35v5.3", key: "lace-4" }],
]);

/**
 * Side-view football helmet — Team tab.
 * Paths from Lucide Lab `football-helmet` (ISC), 24×24 stroke style.
 */
export const HelmetIcon = createLucideIcon("football-helmet", [
  ["path", { d: "M7 14h.01", key: "ear" }],
  [
    "path",
    {
      d: "M21.6 9c-1.3-4-5.1-7-9.6-7C6.5 2 2 6.5 2 12c0 2.6 1 5 3 7c1.4 1.3 3.6 1.4 4.9 0c.7-.7 1-1.6 1-2.5V13c0-1.7 1.3-3 3-3h6.8c.7 0 1-.4.9-1m.4 9H10.7",
      key: "shell",
    },
  ],
  ["path", { d: "M11 14h9a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2c-2.8 0-5-2.2-5-5v-3", key: "mask" }],
]);
