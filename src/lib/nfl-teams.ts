export type NflTeam = {
  /** Sleeper team abbreviation, e.g. "KC". */
  id: string;
  city: string;
  name: string;
  conference: "AFC" | "NFC";
  division: "East" | "North" | "South" | "West";
};

export const NFL_TEAMS: NflTeam[] = [
  { id: "BUF", city: "Buffalo", name: "Bills", conference: "AFC", division: "East" },
  { id: "MIA", city: "Miami", name: "Dolphins", conference: "AFC", division: "East" },
  { id: "NE", city: "New England", name: "Patriots", conference: "AFC", division: "East" },
  { id: "NYJ", city: "New York", name: "Jets", conference: "AFC", division: "East" },
  { id: "BAL", city: "Baltimore", name: "Ravens", conference: "AFC", division: "North" },
  { id: "CIN", city: "Cincinnati", name: "Bengals", conference: "AFC", division: "North" },
  { id: "CLE", city: "Cleveland", name: "Browns", conference: "AFC", division: "North" },
  { id: "PIT", city: "Pittsburgh", name: "Steelers", conference: "AFC", division: "North" },
  { id: "HOU", city: "Houston", name: "Texans", conference: "AFC", division: "South" },
  { id: "IND", city: "Indianapolis", name: "Colts", conference: "AFC", division: "South" },
  { id: "JAX", city: "Jacksonville", name: "Jaguars", conference: "AFC", division: "South" },
  { id: "TEN", city: "Tennessee", name: "Titans", conference: "AFC", division: "South" },
  { id: "DEN", city: "Denver", name: "Broncos", conference: "AFC", division: "West" },
  { id: "KC", city: "Kansas City", name: "Chiefs", conference: "AFC", division: "West" },
  { id: "LV", city: "Las Vegas", name: "Raiders", conference: "AFC", division: "West" },
  { id: "LAC", city: "Los Angeles", name: "Chargers", conference: "AFC", division: "West" },
  { id: "DAL", city: "Dallas", name: "Cowboys", conference: "NFC", division: "East" },
  { id: "NYG", city: "New York", name: "Giants", conference: "NFC", division: "East" },
  { id: "PHI", city: "Philadelphia", name: "Eagles", conference: "NFC", division: "East" },
  { id: "WAS", city: "Washington", name: "Commanders", conference: "NFC", division: "East" },
  { id: "CHI", city: "Chicago", name: "Bears", conference: "NFC", division: "North" },
  { id: "DET", city: "Detroit", name: "Lions", conference: "NFC", division: "North" },
  { id: "GB", city: "Green Bay", name: "Packers", conference: "NFC", division: "North" },
  { id: "MIN", city: "Minnesota", name: "Vikings", conference: "NFC", division: "North" },
  { id: "ATL", city: "Atlanta", name: "Falcons", conference: "NFC", division: "South" },
  { id: "CAR", city: "Carolina", name: "Panthers", conference: "NFC", division: "South" },
  { id: "NO", city: "New Orleans", name: "Saints", conference: "NFC", division: "South" },
  { id: "TB", city: "Tampa Bay", name: "Buccaneers", conference: "NFC", division: "South" },
  { id: "ARI", city: "Arizona", name: "Cardinals", conference: "NFC", division: "West" },
  { id: "LAR", city: "Los Angeles", name: "Rams", conference: "NFC", division: "West" },
  { id: "SF", city: "San Francisco", name: "49ers", conference: "NFC", division: "West" },
  { id: "SEA", city: "Seattle", name: "Seahawks", conference: "NFC", division: "West" },
];

export const teamById = (id: string | null | undefined): NflTeam | undefined =>
  id ? NFL_TEAMS.find((t) => t.id === id.toUpperCase()) : undefined;

export const teamFullName = (id: string | null | undefined): string => {
  const t = teamById(id);
  return t ? `${t.city} ${t.name}` : (id ?? "Free Agent");
};

/** Official-ish primary brand hex for NFL franchise accent bars. */
const TEAM_PRIMARY_COLORS: Record<string, string> = {
  ARI: "#97233F",
  ATL: "#A71930",
  BAL: "#241773",
  BUF: "#00338D",
  CAR: "#0085CA",
  CHI: "#0B162A",
  CIN: "#FB4F14",
  CLE: "#311D00",
  DAL: "#003594",
  DEN: "#FB4F14",
  DET: "#0076B6",
  GB: "#203731",
  HOU: "#03202F",
  IND: "#002C5F",
  JAX: "#006778",
  KC: "#E31837",
  LAC: "#0080C6",
  LAR: "#003594",
  LV: "#000000",
  MIA: "#008E97",
  MIN: "#4F2683",
  NE: "#002244",
  NO: "#D3BC8D",
  NYG: "#0B2265",
  NYJ: "#125740",
  PHI: "#004C54",
  PIT: "#FFB612",
  SEA: "#002244",
  SF: "#AA0000",
  TB: "#D50A0A",
  TEN: "#0C2340",
  WAS: "#5A1414",
  WSH: "#5A1414",
  LA: "#003594",
  JAC: "#006778",
};

/** Primary franchise color for UI accent bars (falls back to slate). */
export function getTeamPrimaryColor(team: string | null | undefined): string {
  const key = (team || "").trim().toUpperCase();
  if (!key || key === "FA") return "#94a3b8";
  return TEAM_PRIMARY_COLORS[key] ?? "#64748b";
}
