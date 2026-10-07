/**
 * Shared Sleeper injury letter / tone helpers for desktop + mobile badges.
 * Colors match broadcast PlayerDetail capsules (amber Q, rose otherwise).
 */

export type InjuryTone = "amber" | "rose";

export type InjuryLetter = "Q" | "O" | "D" | "IR" | "NA" | "PUP" | "SUS" | "COV";

export type InjuryBadgeInfo = {
  letter: InjuryLetter;
  /** Full display label for popup capsules. */
  text: string;
  tone: InjuryTone;
  /** Tailwind fill + text for chips / avatar dots. */
  className: string;
};

const AMBER =
  "bg-amber-500 text-slate-950 border-none font-black shadow-sm shadow-amber-500/10";
const ROSE =
  "bg-rose-600 text-white border-none font-black shadow-sm shadow-rose-600/10";

/** Normalize Sleeper / ESPN injury tokens → badge info (null when healthy). */
export function injuryBadgeInfo(status: string | null | undefined): InjuryBadgeInfo | null {
  const clean = String(status ?? "")
    .trim()
    .toUpperCase()
    .replace(/_/g, " ");
  if (!clean || clean === "NONE" || clean === "HEALTHY" || clean === "ACTIVE" || clean === "AVAILABLE") {
    return null;
  }
  if (clean === "Q" || clean === "QUESTIONABLE") {
    return { letter: "Q", text: "Questionable", tone: "amber", className: AMBER };
  }
  if (clean === "D" || clean === "DOUBTFUL") {
    return { letter: "D", text: "Doubtful", tone: "rose", className: ROSE };
  }
  if (clean === "O" || clean === "OUT") {
    return { letter: "O", text: "Out", tone: "rose", className: ROSE };
  }
  if (clean === "IR" || clean === "INJURED RESERVE") {
    return { letter: "IR", text: "Injured Reserve", tone: "rose", className: ROSE };
  }
  if (clean === "PUP") {
    return { letter: "PUP", text: "PUP", tone: "rose", className: ROSE };
  }
  if (clean === "SUS" || clean === "SUSPENDED" || clean.includes("SUSPENDED")) {
    return { letter: "SUS", text: "Suspended", tone: "rose", className: ROSE };
  }
  if (clean === "COV" || clean === "COVID") {
    return { letter: "COV", text: "COVID", tone: "rose", className: ROSE };
  }
  if (
    clean === "NA" ||
    clean === "NOT ACTIVE" ||
    clean === "INACTIVE" ||
    clean === "EXEMPT" ||
    clean === "DNR"
  ) {
    return { letter: "NA", text: "Not Active", tone: "rose", className: ROSE };
  }
  return null;
}

/** Compact letter for avatar / list chips. */
export function injuryLetter(status: string | null | undefined): InjuryLetter | null {
  return injuryBadgeInfo(status)?.letter ?? null;
}
