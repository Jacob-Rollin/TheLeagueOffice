import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Site page H1 — War Room style. When the title has 2+ words, the last word
 * renders in primary blue (same as "Room" / "Analyzer").
 */
export function PageTitle({
  children,
  className,
  as: Tag = "h1",
}: {
  children: string;
  className?: string;
  as?: "h1" | "h2";
}) {
  const parts = children.trim().split(/\s+/).filter(Boolean);
  let body: ReactNode = children;
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]!;
    const lead = parts.slice(0, -1).join(" ");
    body = (
      <>
        {lead} <span className="text-primary">{last}</span>
      </>
    );
  }

  return <Tag className={cn("display-title text-3xl", className)}>{body}</Tag>;
}
