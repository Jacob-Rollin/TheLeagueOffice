/** Lowercase, strip accents, periods, apostrophes and suffixes (Jr., III). */
export function normName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NICKNAMES: Record<string, string> = {
  kenny: "kenneth",
  chris: "christopher",
  mitch: "mitchell",
  josh: "joshua",
  matt: "matthew",
  mike: "michael",
  nick: "nicholas",
  zach: "zachary",
  cam: "cameron",
  gabe: "gabriel",
  tony: "anthony",
  dan: "daniel",
  will: "william",
  jon: "jonathan",
  hollywood: "marquise",
};

/** Normalized name plus nickname/formal-name variants of the first name. */
export function nameVariants(name: string): string[] {
  const n = normName(name);
  const first = n.split(" ")[0] ?? "";
  const out = new Set([n]);
  for (const [nick, formal] of Object.entries(NICKNAMES)) {
    if (first === nick) out.add(n.replace(/^\S+/, formal));
    if (first === formal) out.add(n.replace(/^\S+/, nick));
  }
  return [...out];
}

const TEAM_ALIASES: Record<string, string> = {
  WSH: "WAS",
  JAC: "JAX",
  LA: "LAR",
  STL: "LAR",
  OAK: "LV",
  SD: "LAC",
};

/** One abbreviation per franchise, matching Sleeper's (LAR, WAS, JAX, LV). */
export function canonTeam(team: string | null | undefined): string {
  const t = (team ?? "").trim().toUpperCase();
  return TEAM_ALIASES[t] ?? t;
}
