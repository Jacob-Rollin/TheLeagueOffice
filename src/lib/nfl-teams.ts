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
