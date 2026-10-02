/**
 * Official weekly injury reports scraped from each club's site (NFL club
 * platform, same markup for all 32): daily practice participation plus the
 * final game designation.
 */

import {
  normPlayerName,
  type AreTheyPlayingPayload,
  type GameStatus,
  type InjuryReportLine,
  type PracticeDay,
  type PracticeMark,
} from "./are-they-playing";

const CLUB_SITES: Record<string, { host: string; name: string }> = {
  ARI: { host: "azcardinals.com", name: "Arizona Cardinals" },
  ATL: { host: "atlantafalcons.com", name: "Atlanta Falcons" },
  BAL: { host: "baltimoreravens.com", name: "Baltimore Ravens" },
  BUF: { host: "buffalobills.com", name: "Buffalo Bills" },
  CAR: { host: "panthers.com", name: "Carolina Panthers" },
  CHI: { host: "chicagobears.com", name: "Chicago Bears" },
  CIN: { host: "bengals.com", name: "Cincinnati Bengals" },
  CLE: { host: "clevelandbrowns.com", name: "Cleveland Browns" },
  DAL: { host: "dallascowboys.com", name: "Dallas Cowboys" },
  DEN: { host: "denverbroncos.com", name: "Denver Broncos" },
  DET: { host: "detroitlions.com", name: "Detroit Lions" },
  GB: { host: "packers.com", name: "Green Bay Packers" },
  HOU: { host: "houstontexans.com", name: "Houston Texans" },
  IND: { host: "colts.com", name: "Indianapolis Colts" },
  JAX: { host: "jaguars.com", name: "Jacksonville Jaguars" },
  KC: { host: "chiefs.com", name: "Kansas City Chiefs" },
  LV: { host: "raiders.com", name: "Las Vegas Raiders" },
  LAC: { host: "chargers.com", name: "Los Angeles Chargers" },
  LAR: { host: "therams.com", name: "Los Angeles Rams" },
  MIA: { host: "miamidolphins.com", name: "Miami Dolphins" },
  MIN: { host: "vikings.com", name: "Minnesota Vikings" },
  NE: { host: "patriots.com", name: "New England Patriots" },
  NO: { host: "neworleanssaints.com", name: "New Orleans Saints" },
  NYG: { host: "giants.com", name: "New York Giants" },
  NYJ: { host: "newyorkjets.com", name: "New York Jets" },
  PHI: { host: "philadelphiaeagles.com", name: "Philadelphia Eagles" },
  PIT: { host: "steelers.com", name: "Pittsburgh Steelers" },
  SF: { host: "49ers.com", name: "San Francisco 49ers" },
  SEA: { host: "seahawks.com", name: "Seattle Seahawks" },
  TB: { host: "buccaneers.com", name: "Tampa Bay Buccaneers" },
  TEN: { host: "tennesseetitans.com", name: "Tennessee Titans" },
  WAS: { host: "commanders.com", name: "Washington Commanders" },
};

const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
const TTL_MS = 15 * 60 * 1000;

const ENTITIES: Record<string, string> = { "&amp;": "&", "&#39;": "'", "&quot;": '"', "&nbsp;": " ", "&#x27;": "'" };

function cellText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toMark(raw: string): PracticeMark | null {
  const v = raw.trim().toUpperCase();
  if (!v) return null;
  if (/^\(?-+\)?$/.test(v)) return "Healthy";
  if (v.startsWith("DNP") || v.includes("DID NOT")) return "DNP";
  if (v.startsWith("LP") || v.includes("LIMITED")) return "LP";
  if (v.startsWith("FP") || v.includes("FULL")) return "FP";
  return null;
}

function toGameStatus(raw: string): GameStatus | null {
  const v = raw.trim().toLowerCase();
  if (v.startsWith("out")) return "Out";
  if (v.startsWith("doubtful")) return "Doubtful";
  if (v.startsWith("questionable")) return "Questionable";
  return null;
}

type ClubReport = { team: string; dayCols: string[]; lines: InjuryReportLine[] };

/** The club's own table is the one whose preceding heading names the club. */
function parseClubReport(html: string, team: string, clubName: string): ClubReport | null {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)];
  for (const match of tables) {
    const start = match.index ?? 0;
    const heading = cellText(html.slice(Math.max(0, start - 1500), start));
    const lastClub = Object.values(CLUB_SITES)
      .map((c) => ({ name: c.name, at: heading.lastIndexOf(c.name) }))
      .filter((c) => c.at >= 0)
      .sort((a, b) => b.at - a.at)[0];
    if (lastClub?.name !== clubName) continue;

    const table = match[0];
    const headers = [...(table.match(/<thead>([\s\S]*?)<\/thead>/)?.[1] ?? "").matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(
      (m) => cellText(m[1] ?? ""),
    );
    const injuryIdx = headers.findIndex((h) => /injur/i.test(h));
    const statusIdx = headers.findIndex((h) => /game status/i.test(h));
    if (injuryIdx < 0 || statusIdx < 0) return null;
    const dayCols = headers.slice(injuryIdx + 1, statusIdx);

    const body = table.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
    const rows = [...body.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((r) =>
      [...r[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => cellText(c[1] ?? "")),
    );

    const lines: InjuryReportLine[] = [];
    for (const cells of rows) {
      const name = cells[0] ?? "";
      const pos = (cells[1] ?? "").toUpperCase();
      if (!name || !FANTASY_POSITIONS.has(pos)) continue;
      const days: PracticeDay[] = dayCols.map((day, i) => ({
        day,
        mark: toMark(cells[injuryIdx + 1 + i] ?? ""),
      }));
      lines.push({
        name,
        team,
        pos,
        injury: cells[injuryIdx]?.trim() || null,
        days,
        gameStatus: toGameStatus(cells[statusIdx] ?? ""),
        final: false,
      });
    }

    // Clubs can rule players Out midweek, so only Questionable/Doubtful or a mark
    // on the last practice day means the final report is out.
    const allRows = rows.map((cells) => ({
      status: toGameStatus(cells[statusIdx] ?? ""),
      lastDay: toMark(cells[statusIdx - 1] ?? ""),
    }));
    const final = allRows.some(
      (r) =>
        r.status === "Questionable" ||
        r.status === "Doubtful" ||
        (dayCols.length > 0 && r.lastDay != null),
    );
    return { team, dayCols, lines: lines.map((l) => ({ ...l, final })) };
  }
  return null;
}

async function fetchClub(team: string, week: number): Promise<ClubReport | null> {
  const club = CLUB_SITES[team];
  if (!club) return null;
  const res = await fetch(`https://www.${club.host}/team/injury-report/week/REG-${week}`, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; TheLeagueOffice/1.0)", accept: "text/html" },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return parseClubReport(await res.text(), team, club.name);
}

/* ---------- ESPN injury feed: fills gaps until the official report catches up ---------- */

type EspnInjury = {
  name: string;
  team: string;
  pos: string;
  status: GameStatus | null;
  injury: string | null;
  date: number;
  comments: string[];
};

type EspnFeed = {
  injuries?: Array<{
    displayName?: string;
    injuries?: Array<{
      status?: string;
      date?: string;
      shortComment?: string;
      longComment?: string;
      type?: { name?: string };
      details?: { type?: string };
      athlete?: { displayName?: string; position?: { abbreviation?: string } };
    }>;
  }>;
};

const TEAM_BY_NAME = new Map(Object.entries(CLUB_SITES).map(([abbr, c]) => [c.name, abbr]));

function espnStatus(typeName: string | undefined, status: string | undefined): GameStatus | null {
  const v = `${typeName ?? ""} ${status ?? ""}`.toUpperCase();
  if (v.includes("QUESTIONABLE")) return "Questionable";
  if (v.includes("DOUBTFUL")) return "Doubtful";
  if (/\bOUT\b|INJURY_STATUS_OUT/.test(v)) return "Out";
  return null;
}

async function fetchEspnInjuries(): Promise<EspnInjury[]> {
  const res = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries", {
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res || !res.ok) return [];
  const json = (await res.json().catch(() => null)) as EspnFeed | null;
  const out: EspnInjury[] = [];
  for (const group of json?.injuries ?? []) {
    const team = TEAM_BY_NAME.get(group.displayName ?? "");
    if (!team) continue;
    for (const inj of group.injuries ?? []) {
      const name = inj.athlete?.displayName?.trim();
      const pos = (inj.athlete?.position?.abbreviation ?? "").toUpperCase();
      if (!name || !FANTASY_POSITIONS.has(pos)) continue;
      const injuryType = inj.details?.type?.trim();
      out.push({
        name,
        team,
        pos,
        status: espnStatus(inj.type?.name, inj.status),
        injury: injuryType && !/not specified|undisclosed/i.test(injuryType) ? injuryType : null,
        date: Date.parse(inj.date ?? "") || 0,
        comments: [inj.shortComment, inj.longComment].filter((c): c is string => Boolean(c?.trim())),
      });
    }
  }
  return out;
}

async function fetchCurrentWeek(): Promise<number | null> {
  const res = await fetch("https://api.sleeper.app/v1/state/nfl", { signal: AbortSignal.timeout(10_000) }).catch(
    () => null,
  );
  if (!res || !res.ok) return null;
  const json = (await res.json().catch(() => null)) as { week?: number } | null;
  return typeof json?.week === "number" ? json.week : null;
}

const DAY_ABBR: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
};
const DAY_INDEX: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function clauseMark(clause: string): PracticeMark | null {
  if (/\b(did not|didn't|unable to) (practice|participate)|\bnon-?participant|\bsat out|\bheld out|\bno practice|\bdnp\b/i.test(clause)) {
    return "DNP";
  }
  if (/\blimited\b|\bpartial\b/i.test(clause)) return "LP";
  if (/\bfull\b|\bfully\b|without limitation|every (practice )?rep/i.test(clause)) return "FP";
  return null;
}

/** Weekday (Mon=1..Sun=7) in US Eastern time. */
function easternWeekday(ms: number): number {
  const name = new Date(ms).toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });
  return ({ Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7 } as Record<string, number>)[
    name
  ] ?? 7;
}

/**
 * Reads practice participation from beat-reporter notes ("was limited at Friday's
 * practice", "upgraded to full participation Thursday") and "added to the injury
 * report Friday" (earlier days were healthy). Only days on or before the note's own
 * weekday count, so last week's notes can't leak in.
 */
function practiceFromNews(comments: string[], noteDate: number): { marks: Map<string, PracticeMark>; addedOn: string | null } {
  const marks = new Map<string, PracticeMark>();
  let addedOn: string | null = null;
  const noteDay = easternWeekday(noteDate);
  for (const text of comments) {
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (!/practic|participa|injury report|session/i.test(sentence)) continue;
      for (const clause of sentence.split(/,|;|\bbut\b|\bthen\b|\bbefore\b|\bafter\b|\band\b/i)) {
        const days = [...clause.matchAll(/\b(monday|tuesday|wednesday|thursday|friday|saturday)\b/gi)].map(
          (m) => DAY_ABBR[(m[1] ?? "").toLowerCase()]!,
        );
        if (days.length !== 1) continue;
        const day = days[0]!;
        if ((DAY_INDEX[day] ?? 9) > noteDay) continue;
        if (/added to the (team's |club's )?injury report/i.test(clause)) addedOn ??= day;
        const mark = clauseMark(clause);
        if (mark && !marks.has(day)) marks.set(day, mark);
      }
    }
  }
  return { marks, addedOn };
}

function fillFromNews(days: PracticeDay[], news: EspnInjury): PracticeDay[] {
  const { marks, addedOn } = practiceFromNews(news.comments, news.date);
  const addedIdx = addedOn ? days.findIndex((d) => d.day === addedOn) : -1;
  return days.map((d, i) => {
    if (d.mark) return d;
    const fromNews = marks.get(d.day);
    if (fromNews) return { ...d, mark: fromNews };
    if (addedIdx > i) return { ...d, mark: "Healthy" };
    return d;
  });
}

/** Most recent Monday 00:00 Eastern (approx; DST drift is irrelevant at day scale). */
function practiceWeekStart(now: number): number {
  const day = easternWeekday(now);
  return now - (day - 1) * 86_400_000 - 12 * 3_600_000;
}

function mergeEspn(reports: ClubReport[], espn: EspnInjury[], now: number): InjuryReportLine[] {
  const since = practiceWeekStart(now);
  const fresh = espn.filter((e) => e.date >= since);
  const byKey = new Map(fresh.map((e) => [`${normPlayerName(e.name)}|${e.team}`, e]));
  const anyByKey = new Map(espn.map((e) => [`${normPlayerName(e.name)}|${e.team}`, e]));
  const dayColsByTeam = new Map(reports.map((r) => [r.team, r.dayCols]));
  const lastName = (name: string) => normPlayerName(name.split(" ").slice(-1)[0] ?? "");
  // ESPN can use a nickname ("Hollywood Brown"), so also guard on surname + team + position.
  const onReport = new Set(
    reports.flatMap((r) => r.lines.map((l) => `${lastName(l.name)}|${l.team}|${l.pos}`)),
  );
  const seen = new Set<string>();
  const out: InjuryReportLine[] = [];

  for (const report of reports) {
    for (const line of report.lines) {
      const key = `${normPlayerName(line.name)}|${line.team}`;
      seen.add(key);
      const news = byKey.get(key);
      const injury = line.injury ?? anyByKey.get(key)?.injury ?? null;
      if (!news) {
        out.push({ ...line, injury });
        continue;
      }
      out.push({
        ...line,
        injury,
        gameStatus: line.gameStatus ?? news.status,
        days: fillFromNews(line.days, news),
      });
    }
  }

  // Designated this week but not on the club's posted report yet.
  for (const news of fresh) {
    const key = `${normPlayerName(news.name)}|${news.team}`;
    if (seen.has(key) || !news.status) continue;
    if (onReport.has(`${lastName(news.name)}|${news.team}|${news.pos}`)) continue;
    seen.add(key);
    const dayCols = dayColsByTeam.get(news.team) ?? ["Wed", "Thu", "Fri"];
    out.push({
      name: news.name,
      team: news.team,
      pos: news.pos,
      injury: news.injury,
      days: fillFromNews(
        dayCols.map((day) => ({ day, mark: null })),
        news,
      ),
      gameStatus: news.status,
      final: false,
    });
  }
  return out;
}

const cache = new Map<number, { at: number; value: Promise<AreTheyPlayingPayload> }>();

async function buildPayload(week: number): Promise<AreTheyPlayingPayload> {
  const [reports, currentWeek] = await Promise.all([
    Promise.all(Object.keys(CLUB_SITES).map((team) => fetchClub(team, week).catch(() => null))),
    fetchCurrentWeek().catch(() => null),
  ]);
  const clubReports = reports.filter((r): r is ClubReport => r != null);
  const espn = currentWeek === week ? await fetchEspnInjuries().catch(() => []) : [];
  const now = Date.now();
  const lines = espn.length ? mergeEspn(clubReports, espn, now) : clubReports.flatMap((r) => r.lines);
  return { week, updatedAt: now, lines };
}

export function loadAreTheyPlaying(week: number): Promise<AreTheyPlayingPayload> {
  const hit = cache.get(week);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = buildPayload(week);
  cache.set(week, { at: Date.now(), value });
  void value.then((payload) => {
    if (payload.lines.length === 0) cache.delete(week);
  });
  return value;
}
