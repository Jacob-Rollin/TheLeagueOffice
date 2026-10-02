import { fetchText } from "./http";
import type { Identity } from "./identity";
import { canonTeam } from "./names";
import { cleanLine, points } from "./scoring";
import type { Pos, SourceResult, Stats } from "./types";

/** Long column titles on the CBS projections tables, mapped to Sleeper keys. */
const COLUMN: Record<string, string> = {
  "Pass Attempts": "pass_att",
  "Pass Completions": "pass_cmp",
  "Passing Yards": "pass_yd",
  "Touchdowns Passes": "pass_td",
  "Interceptions Thrown": "pass_int",
  "Rushing Attempts": "rush_att",
  "Rushing Yards": "rush_yd",
  "Rushing Touchdowns": "rush_td",
  "Fumbles Lost": "fum_lost",
  Targets: "rec_tgt",
  Receptions: "rec",
  "Receiving Yards": "rec_yd",
  "Receiving Touchdowns": "rec_td",
  "Field Goals 1-19 Yards": "fgm_0_19",
  "Field Goals 20-29 Yards": "fgm_20_29",
  "Field Goals 30-39 Yards": "fgm_30_39",
  "Field Goals 40-49 Yards": "fgm_40_49",
  "Field Goals 50+ Yards": "fgm_50p",
  "Field Goals Made": "_fgm",
  "Field Goal Attempts": "_fga",
  "Extra Points Made": "xpm",
  "Extra Points Attempted": "_xpa",
  Interceptions: "int",
  Safeties: "safe",
  Sacks: "sack",
  "Defensive Fumbles Recovered": "fum_rec",
  "Forced Fumbles": "ff",
  "Defensive Touchdowns": "def_td",
  "Points Allowed": "pts_allow",
  "Total Yards Allowed": "yds_allow",
};

const PAGES: { page: string; pos: Pos; minRows: number }[] = [
  { page: "QB", pos: "QB", minRows: 30 },
  { page: "RB", pos: "RB", minRows: 50 },
  { page: "WR", pos: "WR", minRows: 50 },
  { page: "TE", pos: "TE", minRows: 40 },
  { page: "K", pos: "K", minRows: 20 },
  { page: "DST", pos: "DEF", minRows: 20 },
];

const strip = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export async function fetchCbsProjections(
  season: number,
  week: number,
  identity: Identity,
): Promise<SourceResult> {
  const started = Date.now();
  const lines = new Map<string, Stats>();
  const okPositions = new Set<Pos>();
  const problems: string[] = [];
  let unmatched = 0;

  const pages = await Promise.all(
    PAGES.map(async (cfg) => ({
      cfg,
      res: await fetchText(
        `https://www.cbssports.com/fantasy/football/stats/${cfg.page}/${season}/${week}/projections/ppr/`,
      ),
    })),
  );

  for (const { cfg, res } of pages) {
    if (!res.ok || !res.data) {
      problems.push(`${cfg.page} ${res.error}`);
      continue;
    }
    const html = res.data;
    const titles = [...html.matchAll(/<th[^>]*class="TableBase-headTh[^"]*"[^>]*>([\s\S]*?)<\/th>/g)].map((m) => {
      const text = strip(m[1]!);
      return text.split(" ").slice(1).join(" ") || text;
    });
    const rows = (html.split(/<tbody/)[1] ?? "").split(/<tr class="TableBase-bodyTr/).slice(1);
    let parsed = 0;
    for (const tr of rows) {
      const cells = tr
        .split(/<td[^>]*class="TableBase-bodyTd/)
        .slice(1)
        .map((td) => strip(td.replace(/^[^>]*>/, "")));
      const teamLink = tr.match(/\/nfl\/teams\/([A-Z]+)\//)?.[1];
      const team = canonTeam(tr.match(/CellPlayerName-team[^>]*>\s*([A-Z]+)/)?.[1] ?? teamLink ?? "");
      const name = tr.match(/CellPlayerName--long[\s\S]*?<a[^>]*>([^<]+)<\/a>/)?.[1]?.trim() ?? "";
      const raw: Stats = {};
      titles.forEach((title, i) => {
        const key = COLUMN[title];
        const v = Number(cells[i]);
        if (i > 0 && key && Number.isFinite(v)) raw[key] = v;
      });
      if (cfg.pos === "K") {
        if (raw._fga != null && raw._fgm != null) raw.fgmiss = Math.max(0, raw._fga - raw._fgm);
        if (raw._xpa != null && raw.xpm != null) raw.xpmiss = Math.max(0, raw._xpa - raw.xpm);
      }
      let id: string | null;
      if (cfg.pos === "DEF") id = team && identity.players.has(team) ? team : null;
      else {
        const cbsId = tr.match(/\/players\/(\d+)\//)?.[1];
        id = (cbsId && identity.byCbs.get(cbsId)) || identity.findByName(name, cfg.pos, team);
      }
      if (!id) {
        unmatched++;
        continue;
      }
      const line = cleanLine(raw, cfg.pos);
      const pts = points(line);
      if (!line || !pts || pts.every((x) => x === 0)) continue;
      lines.set(id, line);
      parsed++;
    }
    if (parsed >= cfg.minRows) okPositions.add(cfg.pos);
    else problems.push(`${cfg.page} only ${parsed} rows`);
  }

  const ok = okPositions.size === PAGES.length;
  const note = [`${unmatched} unmatched`, ...problems].join(", ");
  return { ok, lines, ms: Date.now() - started, note, okPositions };
}
