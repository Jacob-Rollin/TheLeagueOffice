import { createLucideIcon } from "lucide-react";

/** Vertical football — Matchup tab (outline, lucide stroke style). */
export const FootballIcon = createLucideIcon("football", [
  [
    "path",
    {
      d: "M12 2.75c-2.55 3.35-4.1 6.45-4.1 9.25s1.55 5.9 4.1 9.25c2.55-3.35 4.1-6.45 4.1-9.25S14.55 6.1 12 2.75z",
      key: "shell",
    },
  ],
  ["path", { d: "M12 7.5v9", key: "lace-spine" }],
  ["path", { d: "M10.2 9.25h3.6", key: "lace-1" }],
  ["path", { d: "M10.2 11.35h3.6", key: "lace-2" }],
  ["path", { d: "M10.2 13.45h3.6", key: "lace-3" }],
  ["path", { d: "M10.2 15.55h3.6", key: "lace-4" }],
]);

/** Side-view helmet facing right — Team tab (outline, lucide stroke style). */
export const HelmetIcon = createLucideIcon("football-helmet", [
  [
    "path",
    {
      d: "M14.75 6.25C11.2 4.6 6.6 5.9 5.35 10.4c-1 3.6 1.15 7.35 5.1 8.35.45.1.85.45.95.9l.15.85h2.55c.25-1.45.85-2.7 1.75-3.55.7-.65 1.15-1.55 1.15-2.7V9.1c0-1.15-.55-2.2-2.25-2.85z",
      key: "shell",
    },
  ],
  ["circle", { cx: "10", cy: "12.5", r: "1.2", key: "ear" }],
  ["path", { d: "M15 8.75h3.25a1.1 1.1 0 0 1 1.1 1.1v4.8a1.1 1.1 0 0 1-1.1 1.1H14.8", key: "mask-frame" }],
  ["path", { d: "M15 11.35h4.35", key: "mask-bar-1" }],
  ["path", { d: "M15 13.75h4.35", key: "mask-bar-2" }],
]);
