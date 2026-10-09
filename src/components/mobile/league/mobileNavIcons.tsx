import { createLucideIcon } from "lucide-react";

/**
 * Horizontal American football — Matchup tab.
 * Same pointed prolate shell as the vertical reference, rotated 90°.
 */
export const FootballIcon = createLucideIcon("football", [
  [
    "path",
    {
      // Pointed football silhouette (originally vertical), laid on its side.
      d: "M12 2.75c-2.55 3.35-4.1 6.45-4.1 9.25s1.55 5.9 4.1 9.25c2.55-3.35 4.1-6.45 4.1-9.25S14.55 6.1 12 2.75z",
      transform: "rotate(90 12 12)",
      key: "shell",
    },
  ],
  // Laces along the long axis (5 stitches like the reference).
  ["path", { d: "M7.75 12h8.5", key: "lace-spine" }],
  ["path", { d: "M9.1 10.45v3.1", key: "lace-1" }],
  ["path", { d: "M10.55 10.45v3.1", key: "lace-2" }],
  ["path", { d: "M12 10.45v3.1", key: "lace-3" }],
  ["path", { d: "M13.45 10.45v3.1", key: "lace-4" }],
  ["path", { d: "M14.9 10.45v3.1", key: "lace-5" }],
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
