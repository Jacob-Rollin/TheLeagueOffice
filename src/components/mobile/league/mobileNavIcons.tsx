import { createLucideIcon } from "lucide-react";

/**
 * Horizontal American football — Matchup tab.
 * Long pointed shell (real football proportions) + thin spaced laces.
 */
export const FootballIcon = createLucideIcon("football", [
  [
    "path",
    {
      // Longer tip-to-tip, lower mid height — classic football proportions.
      d: "M0.75 12C3.5 7.6 7.5 6.25 12 6.25S20.5 7.6 23.25 12C20.5 16.4 16.5 17.75 12 17.75S3.5 16.4 0.75 12z",
      key: "shell",
    },
  ],
  // Thin, short, spaced stitches.
  ["path", { d: "M8.5 12h7", strokeWidth: "1.2", key: "lace-spine" }],
  ["path", { d: "M9.7 10.4v3.2", strokeWidth: "1.2", key: "lace-1" }],
  ["path", { d: "M11.25 10.4v3.2", strokeWidth: "1.2", key: "lace-2" }],
  ["path", { d: "M12.75 10.4v3.2", strokeWidth: "1.2", key: "lace-3" }],
  ["path", { d: "M14.3 10.4v3.2", strokeWidth: "1.2", key: "lace-4" }],
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
