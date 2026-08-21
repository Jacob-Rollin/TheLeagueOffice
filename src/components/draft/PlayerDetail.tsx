import { queryOptions, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { useState } from "react";
import { PlayerAvatar } from "./PlayerAvatar";
import { PlayerNews } from "./PlayerNews";
import { PositionBadge } from "./PositionBadge";
import { Button } from "@/components/ui/button";
import { useDraft } from "@/hooks/use-draft";
import { SCORING_LABEL } from "@/lib/draft";
import { getPlayerDetail } from "@/lib/players.functions";
import { cn } from "@/lib/utils";

export const detailQuery = (id: string) =>
  queryOptions({
    queryKey: ["player", id],
    queryFn: () => getPlayerDetail({ data: { id } }),
    staleTime: 1000 * 60 * 30,
  });

export function PlayerDetail({
  id,
  onSelectPlayer,
}: {
  id: string;
  onSelectPlayer?: (id: string) => void;
}) {
  const { data, isLoading } = useQuery(detailQuery(id));
  const draft = useDraft();
  const [tab, setTab] = useState<"overview" | "news">("overview");

  if (isLoading) return <p className="p-6 text-center text-sm text-muted-foreground">Loading player…</p>;
  if (!data) return <p className="p-6 text-center text-sm text-muted-foreground">Player not found.</p>;

  const { player, history, projection, depthChart, sos, injuryRisk, season } = data;
  const scoring = draft.settings.scoring;
  const drafted = draft.draftedIds.has(player.id);
  const watched = draft.watchIds.has(player.id);
  const last = history[0] ?? null;
  const prevSeason = last?.season ?? String(Number(season) - 1);


  return (
    <div className="pb-8">
      <header className="border-b border-border px-3 py-3">
        <div className="flex items-center gap-3 pr-8">
          <PlayerAvatar id={player.id} pos={player.pos} team={player.team} name={player.name} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <PositionBadge pos={player.pos} />
              <h1 className="display-title truncate text-2xl">{player.name}</h1>
              {player.injury && (
                <span className="shrink-0 rounded border border-destructive/40 bg-destructive/15 px-1.5 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-destructive">
                  {player.injury}
                </span>
              )}
            </div>
            <p className="tabnum text-xs text-muted-foreground">
              Rank #{player.rank[scoring]} · {player.pos} · {player.team}
              {player.bye ? ` · Bye ${player.bye}` : ""} · ADP{" "}
              {player.adp[scoring] < 900 ? player.adp[scoring].toFixed(1) : "—"} ·{" "}
              {SCORING_LABEL[scoring]}
              {player.age ? ` · Age ${player.age}` : ""}
              {player.exp !== null ? ` · ${player.exp} yr exp` : ""}
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            className="flex-1 font-display uppercase"
            disabled={drafted}
            onClick={() => draft.draftPlayer(player.id)}
          >
            {drafted ? "Drafted" : "Draft"}
          </Button>
          <Button
            variant={watched ? "default" : "secondary"}
            className="flex-1 font-display uppercase"
            onClick={() => draft.toggleWatch(player.id)}
          >
            {watched ? "Watching" : "Watch"}
          </Button>
        </div>
        <nav className="mt-3 flex gap-1">
          {(
            [
              ["overview", "Overview"],
              ["news", "News"],
            ] as ["overview" | "news", string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "flex-1 rounded-md border px-3 py-1.5 font-display text-sm uppercase tracking-wide transition-colors",
                tab === key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {tab === "news" && <PlayerNews id={player.id} />}

      {tab === "overview" && (
        <>
          <Section title="Stat matrix">
            <StatMatrix
              pos={player.pos}
              season={season}
              prevSeason={prevSeason}
              proj={projection}
              actual={last}
              scoring={scoring}
            />
          </Section>

          <div className="mt-4 px-3">
            <h2 className="font-display text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Analytics
            </h2>
            <div className="mt-1 h-px bg-border" />
          </div>

          <Section title="Injury risk">
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "font-display text-lg uppercase",
                    injuryRisk.label === "High"
                      ? "text-destructive"
                      : injuryRisk.label === "Moderate"
                        ? "text-accent"
                        : "text-primary",
                  )}
                >
                  {injuryRisk.label}
                </span>
                <span className="tabnum text-sm text-muted-foreground">{injuryRisk.score}/100</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-secondary">
                <div className="h-full bg-primary" style={{ width: `${injuryRisk.score}%` }} />
              </div>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {injuryRisk.factors.map((f) => (
                  <li key={f}>· {f}</li>
                ))}
              </ul>
            </div>
          </Section>

          <Section title={`Strength of schedule vs ${player.pos}`}>
            {!sos ? (
              <Empty>Schedule data unavailable for this player.</Empty>
            ) : (
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-lg">{sos.grade}</span>
                  <span className="tabnum text-xs text-muted-foreground">
                    avg opponent rank {sos.rank ?? "—"} / 32 (1 = toughest)
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-6 gap-1 sm:grid-cols-9">
                  {sos.opponents.map((o) => (
                    <div
                      key={o.week}
                      className={cn(
                        "rounded border border-border px-1 py-1 text-center",
                        o.rank !== null && o.rank <= 10 && "bg-destructive/20",
                        o.rank !== null && o.rank >= 23 && "bg-primary/20",
                      )}
                    >
                      <div className="text-[9px] uppercase text-muted-foreground">W{o.week}</div>
                      <div className="tabnum text-[11px] font-semibold">{o.opp}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>

          <Section title={`${player.team} ${player.pos} depth chart`}>
            {depthChart.length === 0 ? (
              <Empty>No teammates found.</Empty>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                {depthChart.map((d) => {
                  const inner = (
                    <>
                      <PositionBadge pos={d.pos} className="h-5 text-[10px]" />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{d.name}</span>
                      {d.injury && (
                        <span className="rounded bg-destructive/20 px-1 text-[10px] font-bold uppercase text-destructive">
                          {d.injury}
                        </span>
                      )}
                      <span className="tabnum text-xs text-muted-foreground">
                        {d.proj.toFixed(1)} proj
                      </span>
                    </>
                  );
                  const klass = cn(
                    "flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-secondary/50",
                    d.id === player.id && "bg-primary/10",
                  );
                  return (
                    <li key={d.id}>
                      {onSelectPlayer ? (
                        <button className={klass} onClick={() => onSelectPlayer(d.id)}>
                          {inner}
                        </button>
                      ) : (
                        <Link to="/player/$id" params={{ id: d.id }} className={klass}>
                          {inner}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <div className="px-3 pt-4">
            <Link to="/player/$id" params={{ id: player.id }} className="block">
              <Button variant="secondary" className="w-full font-display uppercase tracking-wide">
                View Full Player Profile
              </Button>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

const MATRIX_ROWS: Record<string, [string, string][]> = {
  QB: [
    ["pass_yd", "Passing Yards"],
    ["pass_td", "Passing TDs"],
    ["pass_int", "Interceptions"],
    ["rush_yd", "Rushing Yards"],
    ["rush_td", "Rushing TDs"],
  ],
  RB: [
    ["rush_yd", "Rushing Yards"],
    ["rush_td", "Rushing TDs"],
    ["rec_tgt", "Targets"],
    ["rec", "Receptions"],
    ["rec_yd", "Receiving Yards"],
    ["rec_td", "Receiving TDs"],
    ["fum_lost", "Fumbles Lost"],
  ],
  SKILL: [
    ["rec_tgt", "Targets"],
    ["rec", "Receptions"],
    ["rec_yd", "Receiving Yards"],
    ["rec_td", "Receiving TDs"],
    ["rush_yd", "Rushing Yards"],
    ["rush_td", "Rushing TDs"],
    ["fum_lost", "Fumbles Lost"],
  ],
  K: [
    ["fgm", "Field Goals Made"],
    ["fgmiss", "Field Goals Missed"],
    ["xpm", "Extra Points Made"],
  ],
  DEF: [
    ["sack", "Sacks"],
    ["int", "Interceptions"],
    ["def_st_td", "Defensive/ST TDs"],
    ["pts_allow", "Points Allowed"],
  ],
};

function StatMatrix({
  pos,
  season,
  prevSeason,
  proj,
  actual,
  scoring,
}: {
  pos: string;
  season: string;
  prevSeason: string;
  proj: { points: Record<string, number>; games: number; raw: Record<string, number> };
  actual: { points: Record<string, number>; games: number; raw: Record<string, number> } | null;
  scoring: string;
}) {
  const rows =
    MATRIX_ROWS[pos === "QB" || pos === "K" || pos === "DEF" || pos === "RB" ? pos : "SKILL"] ??
    MATRIX_ROWS["SKILL"]!;
  const fmt = (v: number | undefined) =>
    v === undefined || v === null ? "—" : Math.round(v * 10) / 10 === 0 ? "0" : (Math.round(v * 10) / 10).toString();

  const projPts = proj.points[scoring] ?? 0;
  const actPts = actual ? (actual.points[scoring] ?? 0) : null;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/40 font-display text-[10px] uppercase tracking-widest text-muted-foreground">
            <th className="px-3 py-2 text-left">Stat Type</th>
            <th className="px-3 py-2 text-right">{season} Proj</th>
            <th className="px-3 py-2 text-right">{prevSeason} Actual</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(([key, label]) => (
            <tr key={key}>
              <td className="px-3 py-1.5 text-muted-foreground">{label}</td>
              <td className="tabnum px-3 py-1.5 text-right font-mono">{fmt(proj.raw?.[key] ?? 0)}</td>
              <td className="tabnum px-3 py-1.5 text-right font-mono">
                {actual ? fmt(actual.raw?.[key] ?? 0) : "—"}
              </td>
            </tr>
          ))}
          <tr className="border-t border-border bg-secondary/40 font-semibold">
            <td className="px-3 py-1.5 font-display text-xs uppercase tracking-wide">
              Total Points
            </td>
            <td className="tabnum px-3 py-1.5 text-right font-mono">{projPts.toFixed(1)}</td>
            <td className="tabnum px-3 py-1.5 text-right font-mono">
              {actPts === null ? "—" : actPts.toFixed(1)}
            </td>
          </tr>
          <tr className="bg-secondary/40 font-semibold">
            <td className="px-3 py-1.5 font-display text-xs uppercase tracking-wide">
              Weekly Average
            </td>
            <td className="tabnum px-3 py-1.5 text-right font-mono">
              {(projPts / (proj.games || 17)).toFixed(1)}
            </td>
            <td className="tabnum px-3 py-1.5 text-right font-mono">
              {actPts === null || !actual?.games ? "—" : (actPts / actual.games).toFixed(1)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SummaryCard({
  title,
  pts,
  games,
}: {
  title: string;
  pts: number | null;
  games: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="font-display text-xs uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        <li className="flex items-baseline gap-2">
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">PTS</span>
          <span className="tabnum ml-auto font-mono font-semibold">
            {pts === null ? "—" : pts.toFixed(1)}
          </span>
        </li>
        <li className="flex items-baseline gap-2">
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">AVG</span>
          <span className="tabnum ml-auto font-mono font-semibold">
            {pts === null || !games ? "—" : (pts / games).toFixed(1)}
          </span>
        </li>
      </ul>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-3 pt-4">
      <h2 className="mb-2 font-display text-sm uppercase tracking-widest text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}


function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
