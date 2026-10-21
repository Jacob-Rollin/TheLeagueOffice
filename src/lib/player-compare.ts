/**
 * Shared player-compare metric definitions + week-series helpers.
 * Used by mobile and desktop compare UIs.
 */

export type CompareFormat = "std" | "half" | "ppr";

export type CompareMetricDef = {
  key: string;
  label: string;
  /** Raw game-log key(s) to sum, or special handlers. */
  kind: "fpts" | "sum" | "rate";
  rawKeys?: string[];
  numKey?: string;
  denKey?: string;
  higherIsBetter?: boolean;
  decimals?: number;
};

export type CompareSectionDef = {
  id: string;
  title: string;
  metrics: CompareMetricDef[];
};

export type CompareWeekPoint = {
  week: number;
  fpts: number;
  raw: Record<string, number>;
  played: boolean;
  isBye: boolean;
};

export function sectionsForPos(pos: string): CompareSectionDef[] {
  const p = pos.toUpperCase() === "DST" ? "DEF" : pos.toUpperCase();
  if (p === "QB") {
    return [
      {
        id: "stats",
        title: "Season Stats",
        metrics: [
          { key: "fpts", label: "Fan Pts", kind: "fpts", decimals: 2 },
          { key: "pass_yd", label: "Pass Yds", kind: "sum", rawKeys: ["pass_yd"], decimals: 0 },
          { key: "pass_td", label: "Pass TD", kind: "sum", rawKeys: ["pass_td"], decimals: 0 },
          {
            key: "pass_int",
            label: "INT",
            kind: "sum",
            rawKeys: ["pass_int"],
            higherIsBetter: false,
            decimals: 0,
          },
          { key: "rush_yd", label: "Rush Yds", kind: "sum", rawKeys: ["rush_yd"], decimals: 0 },
        ],
      },
      {
        id: "usage",
        title: "Season Usage",
        metrics: [
          { key: "pass_att", label: "Pass Att", kind: "sum", rawKeys: ["pass_att"], decimals: 0 },
          { key: "pass_cmp", label: "Comp", kind: "sum", rawKeys: ["pass_cmp"], decimals: 0 },
          { key: "rush_att", label: "Rush Att", kind: "sum", rawKeys: ["rush_att"], decimals: 0 },
        ],
      },
    ];
  }
  if (p === "RB") {
    return [
      {
        id: "stats",
        title: "Season Stats",
        metrics: [
          { key: "fpts", label: "Fan Pts", kind: "fpts", decimals: 2 },
          { key: "rush_yd", label: "Rush Yds", kind: "sum", rawKeys: ["rush_yd"], decimals: 0 },
          { key: "rush_td", label: "Rush TD", kind: "sum", rawKeys: ["rush_td"], decimals: 0 },
          {
            key: "rush_avg",
            label: "Rush Avg",
            kind: "rate",
            numKey: "rush_yd",
            denKey: "rush_att",
            decimals: 1,
          },
          { key: "rec_yd", label: "Rec Yds", kind: "sum", rawKeys: ["rec_yd"], decimals: 0 },
        ],
      },
      {
        id: "usage",
        title: "Season Usage",
        metrics: [
          { key: "rush_att", label: "Attempts", kind: "sum", rawKeys: ["rush_att"], decimals: 0 },
          {
            key: "touches",
            label: "Touches",
            kind: "sum",
            rawKeys: ["rush_att", "rec"],
            decimals: 0,
          },
          { key: "rec_tgt", label: "Targets", kind: "sum", rawKeys: ["rec_tgt"], decimals: 0 },
          { key: "rec", label: "Receptions", kind: "sum", rawKeys: ["rec"], decimals: 0 },
        ],
      },
    ];
  }
  if (p === "WR" || p === "TE") {
    return [
      {
        id: "stats",
        title: "Season Stats",
        metrics: [
          { key: "fpts", label: "Fan Pts", kind: "fpts", decimals: 2 },
          { key: "rec", label: "Rec", kind: "sum", rawKeys: ["rec"], decimals: 0 },
          { key: "rec_yd", label: "Rec Yds", kind: "sum", rawKeys: ["rec_yd"], decimals: 0 },
          { key: "rec_td", label: "Rec TD", kind: "sum", rawKeys: ["rec_td"], decimals: 0 },
          { key: "rush_yd", label: "Rush Yds", kind: "sum", rawKeys: ["rush_yd"], decimals: 0 },
        ],
      },
      {
        id: "usage",
        title: "Season Usage",
        metrics: [
          { key: "rec_tgt", label: "Targets", kind: "sum", rawKeys: ["rec_tgt"], decimals: 0 },
          { key: "rec", label: "Receptions", kind: "sum", rawKeys: ["rec"], decimals: 0 },
          {
            key: "catch_pct",
            label: "Catch %",
            kind: "rate",
            numKey: "rec",
            denKey: "rec_tgt",
            decimals: 1,
          },
          {
            key: "touches",
            label: "Touches",
            kind: "sum",
            rawKeys: ["rush_att", "rec"],
            decimals: 0,
          },
        ],
      },
    ];
  }
  if (p === "K") {
    return [
      {
        id: "stats",
        title: "Season Stats",
        metrics: [
          { key: "fpts", label: "Fan Pts", kind: "fpts", decimals: 2 },
          { key: "fgm", label: "FGM", kind: "sum", rawKeys: ["fgm"], decimals: 0 },
          { key: "fga", label: "FGA", kind: "sum", rawKeys: ["fga"], decimals: 0 },
          { key: "xpm", label: "XPM", kind: "sum", rawKeys: ["xpm"], decimals: 0 },
        ],
      },
      {
        id: "usage",
        title: "Season Usage",
        metrics: [
          { key: "fga", label: "FG Att", kind: "sum", rawKeys: ["fga"], decimals: 0 },
          { key: "xpa", label: "XP Att", kind: "sum", rawKeys: ["xpa"], decimals: 0 },
        ],
      },
    ];
  }
  if (p === "DEF") {
    return [
      {
        id: "stats",
        title: "Season Stats",
        metrics: [
          { key: "fpts", label: "Fan Pts", kind: "fpts", decimals: 2 },
          { key: "sack", label: "Sack", kind: "sum", rawKeys: ["sack"], decimals: 0 },
          { key: "int", label: "INT", kind: "sum", rawKeys: ["int"], decimals: 0 },
          { key: "fum_rec", label: "FR", kind: "sum", rawKeys: ["fum_rec"], decimals: 0 },
          { key: "def_td", label: "TD", kind: "sum", rawKeys: ["def_td"], decimals: 0 },
        ],
      },
      {
        id: "usage",
        title: "Season Usage",
        metrics: [
          {
            key: "pts_allow",
            label: "Pts Allow",
            kind: "sum",
            rawKeys: ["pts_allow"],
            higherIsBetter: false,
            decimals: 0,
          },
          { key: "sack", label: "Sacks", kind: "sum", rawKeys: ["sack"], decimals: 0 },
        ],
      },
    ];
  }
  return [
    {
      id: "stats",
      title: "Season Stats",
      metrics: [{ key: "fpts", label: "Fan Pts", kind: "fpts", decimals: 2 }],
    },
  ];
}

/** Merge sections when comparing cross-position — Fan Pts first, then unique metrics. */
export function mergeCompareSections(posA: string, posB: string): CompareSectionDef[] {
  const a = sectionsForPos(posA);
  const b = sectionsForPos(posB);
  if (posA.toUpperCase() === posB.toUpperCase()) return a;
  const byId = new Map<string, CompareSectionDef>();
  for (const src of [...a, ...b]) {
    const existing = byId.get(src.id);
    if (!existing) {
      byId.set(src.id, { ...src, metrics: [...src.metrics] });
      continue;
    }
    const seen = new Set(existing.metrics.map((m) => m.key));
    for (const m of src.metrics) {
      if (!seen.has(m.key)) {
        existing.metrics.push(m);
        seen.add(m.key);
      }
    }
  }
  return [...byId.values()];
}

export function metricSeasonValue(
  metric: CompareMetricDef,
  weeks: CompareWeekPoint[],
): number | null {
  if (!weeks.length) return null;
  if (metric.kind === "fpts") {
    return weeks.reduce((n, w) => n + (w.played ? w.fpts : 0), 0);
  }
  if (metric.kind === "sum") {
    let total = 0;
    let any = false;
    for (const w of weeks) {
      if (!w.played) continue;
      for (const k of metric.rawKeys ?? []) {
        const v = Number(w.raw[k]);
        if (Number.isFinite(v)) {
          total += v;
          any = true;
        }
      }
    }
    return any ? total : null;
  }
  if (metric.kind === "rate") {
    let num = 0;
    let den = 0;
    for (const w of weeks) {
      if (!w.played) continue;
      const n = Number(w.raw[metric.numKey ?? ""]);
      const d = Number(w.raw[metric.denKey ?? ""]);
      if (Number.isFinite(n)) num += n;
      if (Number.isFinite(d)) den += d;
    }
    if (!(den > 0)) return null;
    const ratio = num / den;
    if (metric.key === "catch_pct") return ratio * 100;
    return ratio;
  }
  return null;
}

/** Graph points always numeric — bye / no-play / missing stat → 0. */
export function metricWeekValueForGraph(
  metric: CompareMetricDef,
  week: CompareWeekPoint | undefined,
): number {
  if (!week || week.isBye || !week.played) return 0;
  if (metric.kind === "fpts") return Number.isFinite(week.fpts) ? week.fpts : 0;
  if (metric.kind === "sum") {
    let total = 0;
    for (const k of metric.rawKeys ?? []) {
      const v = Number(week.raw[k]);
      if (Number.isFinite(v)) total += v;
    }
    return total;
  }
  if (metric.kind === "rate") {
    const n = Number(week.raw[metric.numKey ?? ""]);
    const d = Number(week.raw[metric.denKey ?? ""]);
    if (!(Number.isFinite(d) && d > 0 && Number.isFinite(n))) return 0;
    return metric.key === "catch_pct" ? (n / d) * 100 : n / d;
  }
  return 0;
}

/** Absence label for a 0 graph point — omit when the player was active (true goose egg). */
export function weekAbsenceNote(week: CompareWeekPoint | undefined): "BYE" | "Out" | null {
  if (!week) return "Out";
  if (week.isBye) return "BYE";
  if (!week.played) return "Out";
  return null;
}

export function formatCompareMetric(v: number | null, decimals = 1): string {
  if (v == null || !Number.isFinite(v)) return "-";
  return decimals === 0 ? String(Math.round(v)) : v.toFixed(decimals);
}

export function compactCompareName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return (parts[0] ?? "").toUpperCase();
  return `${parts[0]![0]!.toUpperCase()}. ${parts.slice(1).join(" ").toUpperCase()}`;
}

export function comparePosLabel(pos: string): string {
  return pos === "DEF" ? "DST" : pos || "RNK";
}
