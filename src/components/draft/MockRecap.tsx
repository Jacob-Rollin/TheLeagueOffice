import { useMemo } from "react";

import { PositionBadge } from "./PositionBadge";
import { playerValue } from "@/lib/evaluate";
import {
  fillRoster,
  roundOf,
  teamName,
  value,
  type Pick,
  type Player,
  type Settings,
} from "@/lib/draft";
import { cn } from "@/lib/utils";

/** Deterministic pseudo-random generator so a recap never reshuffles on re-render. */
function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

type TeamPick = { pick: Pick; player: Player; adp: number; delta: number };

type TeamRecap = {
  team: number;
  name: string;
  picks: TeamPick[];
  starters: number;
  depth: number;
  score: number;
  grade: string;
  tone: "good" | "even" | "bad";
  best: TeamPick | null;
  reach: TeamPick | null;
  tag: string;
  wins: number;
  losses: number;
  pointsFor: number;
};

function letter(pct: number): { grade: string; tone: "good" | "even" | "bad" } {
  if (pct >= 12) return { grade: "A+", tone: "good" };
  if (pct >= 7) return { grade: "A", tone: "good" };
  if (pct >= 3) return { grade: "B+", tone: "good" };
  if (pct >= 0.5) return { grade: "B", tone: "good" };
  if (pct >= -2) return { grade: "C+", tone: "even" };
  if (pct >= -5) return { grade: "C", tone: "even" };
  if (pct >= -9) return { grade: "D", tone: "bad" };
  return { grade: "F", tone: "bad" };
}

function tagFor(picks: TeamPick[]): string {
  const early = picks.filter((p) => p.pick.overall <= 0 || true).slice(0, 4);
  const count = (pos: string, list: TeamPick[]) => list.filter((p) => p.player.pos === pos).length;
  const rbEarly = count("RB", early);
  const wrEarly = count("WR", early);
  const qb = picks.find((p) => p.player.pos === "QB");
  if (rbEarly >= 3) return "Ground Control";
  if (rbEarly === 0 && wrEarly >= 3) return "Zero RB Believer";
  if (rbEarly >= 1 && wrEarly >= 2) return "Hero RB Balance";
  if (qb && picks.indexOf(qb) <= 1) return "Early Elite QB";
  const steals = picks.filter((p) => p.delta >= 12).length;
  if (steals >= 4) return "Value Vulture";
  return "Best Available Board";
}

export function MockRecap({
  settings,
  picks,
  byId,
  playoffsStartWeek = 15,
}: {
  settings: Settings;
  picks: Pick[];
  byId: Map<string, Player>;
  /** Regular season runs through the week before this one. */
  playoffsStartWeek?: number;
}) {
  const recap = useMemo(() => {
    const enriched: TeamPick[] = [];
    for (const pick of picks) {
      const player = byId.get(pick.playerId);
      if (!player) continue;
      const raw = player.adp[settings.scoring];
      const adp = raw && raw < 900 ? raw : settings.teams * settings.rounds;
      enriched.push({ pick, player, adp, delta: adp - pick.overall });
    }

    const teams: TeamRecap[] = [];
    for (let t = 1; t <= settings.teams; t++) {
      const mine = enriched.filter((e) => e.pick.team === t);
      const roster = mine.map((e) => e.player);
      const slots = fillRoster(roster, settings.roster);
      const starterIds = new Set(
        slots.filter((s) => s.slot !== "BN" && s.player).map((s) => s.player!.id),
      );
      const starters = roster
        .filter((p) => starterIds.has(p.id))
        .reduce((sum, p) => sum + playerValue(p, settings.scoring), 0);
      const depth = roster
        .filter((p) => !starterIds.has(p.id))
        .reduce((sum, p) => sum + playerValue(p, settings.scoring), 0);
      // Value-over-replacement weighting: bench value still counts, so hoarding
      // a falling stud is never punished versus reaching for a thin starter.
      const score = starters + depth * 0.45;
      const sorted = [...mine].sort((a, b) => b.delta - a.delta);
      teams.push({
        team: t,
        name: teamName(settings, t),
        picks: mine,
        starters,
        depth,
        score,
        grade: "C",
        tone: "even",
        best: sorted[0] ?? null,
        reach: sorted.length > 1 ? sorted[sorted.length - 1]! : null,
        tag: tagFor(mine),
        wins: 0,
        losses: 0,
        pointsFor: 0,
      });
    }

    const mean = teams.reduce((s, t) => s + t.score, 0) / Math.max(1, teams.length);
    for (const t of teams) {
      const pct = ((t.score - mean) / Math.max(1, mean)) * 100;
      const g = letter(pct);
      t.grade = g.grade;
      t.tone = g.tone;
    }

    // Simulated regular season sized by the configured playoff start week: weekly output scales with lineup
    // strength, with variance damped by bench depth.
    const rand = rng(picks.length * 7919 + settings.teams * 104729);
    const weeks = Math.max(1, playoffsStartWeek - 1);
    const n = teams.length;
    for (let w = 0; w < weeks; w++) {
      const scores = teams.map((t) => {
        const base = t.score / 9;
        const stability = 0.18 - Math.min(0.08, t.depth / 40000);
        return base * (1 + (rand() - 0.5) * 2 * stability * 2);
      });
      // Circle-method round robin: every team plays exactly one game per week.
      const rot = [0, ...Array.from({ length: n - 1 }, (_, k) => 1 + ((k + w) % (n - 1)))];
      for (let s = 0; s < Math.floor(n / 2); s++) {
        const i = rot[s]!;
        const j = rot[n - 1 - s]!;
        if (i === j) continue;
        const a = scores[i]!;
        const b = scores[j]!;
        teams[i]!.pointsFor += a;
        teams[j]!.pointsFor += b;
        if (a >= b) {
          teams[i]!.wins++;
          teams[j]!.losses++;
        } else {
          teams[j]!.wins++;
          teams[i]!.losses++;
        }
      }

    }

    const standings = [...teams].sort(
      (a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor,
    );
    // Kickers and defenses are never eligible for the steal spotlight.
    const steal =
      [...enriched]
        .filter((e) => e.player.pos !== "K" && e.player.pos !== "DEF")
        .sort((a, b) => b.delta - a.delta)[0] ?? null;
    return { teams, standings, steal };
  }, [picks, byId, settings, playoffsStartWeek]);

  const { standings, steal, teams } = recap;

  return (
    <div className="space-y-4 px-3">
      {/* 1. Steal of the night */}
      {steal && (
        <section className="overflow-hidden rounded-xl border border-primary/40 bg-gradient-to-r from-primary/10 via-card to-card">
          <div className="flex flex-wrap items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <div className="font-display text-[11px] uppercase tracking-widest text-primary">
                Draft Steal of the Night
              </div>
              <div className="mt-1 flex items-center gap-2">
                <PositionBadge pos={steal.player.pos} className="h-6 text-[11px]" />
                <h2 className="display-title text-2xl">{steal.player.name}</h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {teamName(settings, steal.pick.team)} landed him at{" "}
                <span className="tabnum font-semibold text-foreground">
                  {roundOf(steal.pick.overall, settings.teams)}.
                  {(((steal.pick.overall - 1) % settings.teams) + 1).toString().padStart(2, "0")}
                </span>{" "}
                — an ADP of {steal.adp.toFixed(0)} overall.
              </p>
            </div>
            <div className="rounded-lg border border-primary/40 bg-background px-4 py-3 text-center">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Value Drop
              </div>
              <div className="tabnum font-display text-3xl font-semibold text-primary">
                +{Math.max(0, Math.round(steal.delta))}
              </div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                picks
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 2. Simulated standings */}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <header className="border-b border-border px-4 py-2.5">
          <h3 className="font-display text-sm uppercase tracking-widest">
            Projected Standings — Simulated Season
          </h3>
          <p className="text-[11px] text-muted-foreground">
            {Math.max(1, playoffsStartWeek - 1)}-week schedule simulation weighted by lineup
            strength and bench depth.
          </p>
        </header>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground">
              <th className="px-4 py-2 text-left font-display">#</th>
              <th className="px-2 py-2 text-left font-display">Team</th>
              <th className="px-2 py-2 text-right font-display">Record</th>
              <th className="px-2 py-2 text-right font-display">Proj PF</th>
              <th className="px-4 py-2 text-right font-display">Grade</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((t, i) => (
              <tr
                key={t.team}
                className={cn(
                  "border-b border-border/60 last:border-0",
                  t.team === settings.myTeam && "bg-primary/10",
                )}
              >
                <td className="tabnum px-4 py-2 text-muted-foreground">{i + 1}</td>
                <td className="px-2 py-2 font-semibold">
                  {t.name}
                  {t.team === settings.myTeam && (
                    <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-primary-foreground">
                      You
                    </span>
                  )}
                </td>
                <td className="tabnum px-2 py-2 text-right">
                  {t.wins}-{t.losses}
                </td>
                <td className="tabnum px-2 py-2 text-right text-muted-foreground">
                  {t.pointsFor.toFixed(0)}
                </td>
                <td className="px-4 py-2 text-right">
                  <GradePill grade={t.grade} tone={t.tone} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 3. Team grade cards */}
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {teams.map((t) => (
          <article key={t.team} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h4 className="truncate font-display text-lg">{t.name}</h4>
                <span className="mt-1 inline-block rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                  {t.tag}
                </span>
              </div>
              <GradePill grade={t.grade} tone={t.tone} big />
            </div>
            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Best Value Pick
                </dt>
                <dd className="truncate">
                  {t.best ? (
                    <>
                      <span className="font-semibold">{t.best.player.name}</span>{" "}
                      <span className="tabnum text-xs text-emerald-600">
                        +{Math.max(0, Math.round(t.best.delta))}
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Biggest Reach
                </dt>
                <dd className="truncate">
                  {t.reach ? (
                    <>
                      <span className="font-semibold">{t.reach.player.name}</span>{" "}
                      <span className="tabnum text-xs text-destructive">
                        {Math.round(t.reach.delta)}
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Projected Starters
                </dt>
                <dd className="tabnum">
                  {t.picks
                    .reduce((sum, p) => sum + value(p.player, settings.scoring).proj, 0)
                    .toFixed(0)}{" "}
                  proj pts
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </section>
    </div>
  );
}

function GradePill({
  grade,
  tone,
  big,
}: {
  grade: string;
  tone: "good" | "even" | "bad";
  big?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-grid place-items-center rounded-lg border font-display font-semibold",
        big ? "size-11 text-xl" : "size-7 text-xs",
        tone === "good" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
        tone === "even" && "border-border bg-muted text-foreground",
        tone === "bad" && "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      {grade}
    </span>
  );
}
