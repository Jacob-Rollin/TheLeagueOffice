/**
 * Shared ownership pool + My Team lens for research boards.
 *
 * Row tints stay ownership signals (my team / taken / available).
 * Pool filters are separate: All · Rostered · Available.
 */

export type ResearchOwnership = "roster" | "taken" | "available";

/** League pool filter — exclusive. "rostered" = my team + taken (no free agents). */
export type ResearchAvailabilityPool = "all" | "rostered" | "available";

export type ResearchAvailabilityState = {
  pool: ResearchAvailabilityPool;
  /** When true, show only the active manager's roster (ignores pool). */
  myTeamOnly: boolean;
};

export const RESEARCH_AVAILABILITY_POOLS: {
  value: ResearchAvailabilityPool;
  label: string;
}[] = [
  { value: "all", label: "All" },
  { value: "rostered", label: "Rostered" },
  { value: "available", label: "Available" },
];

/** Row-tint labels — not the same vocabulary as the Rostered pool filter. */
export const RESEARCH_OWNERSHIP_META: Record<
  ResearchOwnership,
  { label: string; row: string }
> = {
  roster: { label: "My team", row: "bg-sky-50/90" },
  taken: { label: "Taken", row: "bg-white" },
  available: { label: "Available", row: "bg-emerald-50/80" },
};

export function resolveResearchOwnership(
  playerId: string,
  myIds: Set<string>,
  rosteredIds: Set<string>,
): ResearchOwnership {
  if (myIds.has(playerId)) return "roster";
  if (rosteredIds.has(playerId)) return "taken";
  return "available";
}

export function matchesResearchAvailability(
  ownership: ResearchOwnership,
  state: ResearchAvailabilityState,
): boolean {
  if (state.myTeamOnly) return ownership === "roster";
  if (state.pool === "all") return true;
  if (state.pool === "rostered") return ownership === "roster" || ownership === "taken";
  return ownership === "available";
}
