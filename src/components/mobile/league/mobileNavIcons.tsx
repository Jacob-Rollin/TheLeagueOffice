import { createLucideIcon } from "lucide-react";

/**
 * Horizontal American football — Matchup tab.
 * Long pointed shell (real football proportions) + thin spaced laces.
 */
export const FootballIcon = createLucideIcon("football", [
  [
    "path",
    {
      // Elongated prolate shape — long tip-to-tip, modest mid height.
      d: "M1 12C3.75 7.1 7.75 5.5 12 5.5S20.25 7.1 23 12C20.25 16.9 16.25 18.5 12 18.5S3.75 16.9 1 12z",
      key: "shell",
    },
  ],
  // Thinner lace strokes so they don't bunch at 20px.
  ["path", { d: "M8.25 12h7.5", strokeWidth: "1.35", key: "lace-spine" }],
  ["path", { d: "M9.5 10.15v3.7", strokeWidth: "1.35", key: "lace-1" }],
  ["path", { d: "M11.15 10.15v3.7", strokeWidth: "1.35", key: "lace-2" }],
  ["path", { d: "M12.85 10.15v3.7", strokeWidth: "1.35", key: "lace-3" }],
  ["path", { d: "M14.5 10.15v3.7", strokeWidth: "1.35", key: "lace-4" }],
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
