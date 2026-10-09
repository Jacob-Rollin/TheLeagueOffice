import { createLucideIcon } from "lucide-react";

/**
 * Horizontal American football — Matchup tab.
 * Reference silhouette laid on its side: pointed tips, ~1.55:1 length, fills the box.
 */
export const FootballIcon = createLucideIcon("football", [
  [
    "path",
    {
      // Big pointed shell — tip-to-tip nearly full width, mid height like a real ball.
      d: "M1 12C4.5 6.25 8.25 4.75 12 4.75S19.5 6.25 23 12C19.5 17.75 15.75 19.25 12 19.25S4.5 17.75 1 12z",
      key: "shell",
    },
  ],
  // Four short thin stitches (reference lace count), no heavy spine bar.
  ["path", { d: "M9.6 10.35v3.3", strokeWidth: "1.15", key: "lace-1" }],
  ["path", { d: "M11.2 10.35v3.3", strokeWidth: "1.15", key: "lace-2" }],
  ["path", { d: "M12.8 10.35v3.3", strokeWidth: "1.15", key: "lace-3" }],
  ["path", { d: "M14.4 10.35v3.3", strokeWidth: "1.15", key: "lace-4" }],
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
