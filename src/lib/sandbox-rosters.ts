import type { Player, Pos } from "@/lib/draft";

/**
 * Shared sandbox/demo roster sourcing.
 *
 * Both the Trade Analyzer sidebars and any page that needs demo injury
 * telemetry read from this module so the data stays unified with the global
 * player catalog (the same catalog the War Room and Mock Draft pages use).
 */


/** Case-insensitive injury status -> colored micro-badge descriptor. */
export function injuryMicroBadge(
  status: string | null | undefined,
): { label: string; className: string } | null {
  const currentStatus = (status ?? "").trim().toLowerCase();
  if (!currentStatus || currentStatus === "healthy") return null;
  if (currentStatus === "out") return { label: "O", className: "bg-rose-600" };
  if (currentStatus === "ir" || currentStatus === "injured reserve")
    return { label: "IR", className: "bg-rose-600" };
  if (currentStatus === "questionable") return { label: "Q", className: "bg-amber-500" };
  if (currentStatus === "doubtful") return { label: "D", className: "bg-rose-600" };
  if (currentStatus === "na" || currentStatus === "not active" || currentStatus === "suspended") return { label: "NA", className: "bg-red-500" };
  return null;
}

type InjuryCarrier = {
  id: string;
  name?: string | null;
  injury?: string | null;
  injuryStatus?: string | null;
  injury_status?: string | null;
  status?: string | null;
};

/**
 * Resolve a player's injury designation from the Sleeper catalog fields only.
 * Matches Sleeper / player popup — do not use LeagueLogs brain status here;
 * that feed can lag or disagree and caused false Out chips on research lists.
 *
 * The optional `brain` argument is ignored (kept for call-site compatibility).
 *
 * Returns undefined for healthy/empty so no badge or spacing renders.
 */
export function resolveInjuryStatus(
  player: InjuryCarrier,
  _brain?: Record<
    string,
    { injuryStatus?: string | null; injury_status?: string | null } | undefined
  > | null,
): string | undefined {
  const normalize = (value: string | null | undefined): string | undefined => {
    if (!value?.trim()) return undefined;
    const trimmed = value.trim();
    const lower = trimmed.toLowerCase();
    if (
      lower === "healthy" ||
      lower === "active" ||
      lower === "none" ||
      lower === "available"
    ) {
      return undefined;
    }
    if (lower === "na" || lower === "suspended" || lower.includes("suspended")) {
      return "NA";
    }
    return trimmed;
  };

  // Prefer explicit injury fields over generic roster `status` (Active/Inactive).
  return (
    normalize(player.injury_status) ??
    normalize(player.injuryStatus) ??
    normalize(player.injury) ??
    normalize(player.status)
  );
}

type SandboxSpec = { id: string; name: string; pos: Pos; team: string };

const SANDBOX_MY_TEAM_SPEC: SandboxSpec[] = [
  { id: "4046", name: "Patrick Mahomes", pos: "QB", team: "KC" },
  { id: "4866", name: "Saquon Barkley", pos: "RB", team: "PHI" },
  { id: "9221", name: "Jahmyr Gibbs", pos: "RB", team: "DET" },
  { id: "6786", name: "CeeDee Lamb", pos: "WR", team: "DAL" },
  { id: "6801", name: "Tee Higgins", pos: "WR", team: "CIN" },
  { id: "10859", name: "Sam LaPorta", pos: "TE", team: "DET" },
  { id: "6813", name: "Jonathan Taylor", pos: "RB", team: "IND" },
];

const SANDBOX_RIVAL_SPECS: { key: string; name: string; players: SandboxSpec[] }[] = [
  {
    key: "demo-1",
    name: "Demo Team 1",
    players: [
      { id: "4984", name: "Josh Allen", pos: "QB", team: "BUF" },
      { id: "3198", name: "Derrick Henry", pos: "RB", team: "BAL" },
      { id: "8155", name: "Breece Hall", pos: "RB", team: "NYJ" },
      { id: "6794", name: "Justin Jefferson", pos: "WR", team: "MIN" },
      { id: "7547", name: "Amon-Ra St. Brown", pos: "WR", team: "DET" },
      { id: "1466", name: "Travis Kelce", pos: "TE", team: "KC" },
      { id: "7594", name: "Chuba Hubbard", pos: "RB", team: "CAR" },
    ],
  },
  {
    key: "demo-2",
    name: "Demo Team 2",
    players: [
      { id: "6904", name: "Jalen Hurts", pos: "QB", team: "PHI" },
      { id: "4199", name: "Aaron Jones", pos: "RB", team: "MIN" },
      { id: "9509", name: "Bijan Robinson", pos: "RB", team: "ATL" },
      { id: "7564", name: "Ja'Marr Chase", pos: "WR", team: "CIN" },
      { id: "8146", name: "Garrett Wilson", pos: "WR", team: "NYJ" },
      { id: "4039", name: "Cooper Kupp", pos: "WR", team: "SEA" },
      { id: "4217", name: "George Kittle", pos: "TE", team: "SF" },
    ],
  },
];

/** Minimal stub used only when a player is missing from the global catalog. */
function stubPlayer(spec: SandboxSpec): Player {
  return {
    id: spec.id,
    name: spec.name,
    pos: spec.pos,
    team: spec.team,
    age: null,
    exp: null,
    injury_status: null,
    injury: null,
    bye: null,
    adp: { std: 999, half: 999, ppr: 999 },
    adpRange: { min: 999, max: 999 },
    rank: { std: 999, half: 999, ppr: 999 },
    posRank: 999,
    proj: { std: 0, half: 0, ppr: 0 },
    prev: { std: 0, half: 0, ppr: 0 },
  };
}

export type SandboxTeam = { key: string; name: string; owner: string; players: Player[] };

/**
 * Demo assets are decommissioned. With no synced league the sidebars stay
 * empty so the desk runs in pure asset-valuation mode instead of grading
 * against fabricated rosters.
 */
export function buildSandboxTeams(_catalog: Player[]): {
  myTeam: Player[];
  rivalTeams: SandboxTeam[];
} {
  void _catalog;
  void SANDBOX_MY_TEAM_SPEC;
  void SANDBOX_RIVAL_SPECS;
  void stubPlayer;
  return { myTeam: [], rivalTeams: [] };
}
