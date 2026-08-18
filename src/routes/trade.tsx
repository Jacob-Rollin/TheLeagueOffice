import { queryOptions, useQueries, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PlayerPicker } from "@/components/league/PlayerPicker";
import { PositionBadge } from "@/components/draft/PositionBadge";
import type { Player, Scoring } from "@/lib/draft";
import { grade } from "@/lib/evaluate";
import { getPlayerDetail, getPlayers } from "@/lib/players.functions";
import type { PlayerDetail } from "@/lib/players.server";
import { cn } from "@/lib/utils";
import { useDraft } from "@/hooks/use-draft";

const playersQuery = queryOptions({
  queryKey: ["players"],
  queryFn: () => getPlayers(),
  staleTime: 1000 * 60 * 30,
});

const detailQuery = (id: string) =>
  queryOptions({
    queryKey: ["player-detail", id],
    queryFn: () => getPlayerDetail({ data: { id } }),
    staleTime: 1000 * 60 * 30,
  });

export const Route = createFileRoute("/trade")({
  head: () => ({
    meta: [
      { title: "Trade Analyzer — The League Office" },
      {
        name: "description",
        content:
          "Analyze fantasy football trades with last season's stats, this year's projections, weekly averages and roster-need adjustments.",
      },
      { property: "og:title", content: "Trade Analyzer — The League Office" },
      {
        property: "og:description",
        content: "Side-by-side prior-year stats and projections for every trade you consider.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => {
    void context.queryClient.ensureQueryData(playersQuery);
  },
  component: TradePage,
});

const WEEKS = 17;

type Metrics = {
  player: Player;
  projTotal: number;
  projPerWk: number;
  prevTotal: number;
  prevGames: number;
  prevPerGame: number;
  posRank: number | null;
  prevSeason: string | null;
  line: { label: string; value: string }[];
  weekly: number;
};

const LOWER_IS_BETTER = new Set(["Pts allowed"]);

function metricsFor(player: Player, detail: PlayerDetail | undefined, scoring: Scoring): Metrics {
  const prevLine = detail?.history?.[0] ?? null;
  const projTotal = detail?.projection?.points?.[scoring] ?? player.proj?.[scoring] ?? 0;
  const prevTotal = prevLine?.points?.[scoring] ?? player.prev?.[scoring] ?? 0;
  const prevGames = prevLine?.games ?? 0;
  const prevPerGame = prevGames > 0 ? prevTotal / prevGames : 0;
  const projPerWk = projTotal / WEEKS;
  return {
    player,
    projTotal,
    projPerWk,
    prevTotal,
    prevGames,
    prevPerGame,
    posRank: prevLine?.posRank ?? null,
    prevSeason: prevLine?.season ?? null,
    line: prevLine?.line ?? [],
    weekly: projPerWk * 0.65 + prevPerGame * 0.35,
  };
}

/** Star premium: the best asset in a package carries most of the weight. */
function packageWeekly(rows: Metrics[]): number {
  return rows
    .map((r) => r.weekly)
    .sort((a, b) => b - a)
    .reduce((sum, v, i) => sum + v * Math.pow(0.9, i), 0);
}

function TradePage() {
  const { data } = useSuspenseQuery(playersQuery);
  const draft = useDraft();
  const [give, setGive] = useState<Player[]>([]);
  const [get, setGet] = useState<Player[]>([]);
  const [tab, setTab] = useState<"overview" | "stats">("overview");
  const scoring = draft.settings.scoring;

  const selected = useMemo(() => [...give, ...get], [give, get]);
  const details = useQueries({
    queries: selected.map((p) => detailQuery(p.id)),
    combine: (results) => {
      const map = new Map<string, PlayerDetail>();
      results.forEach((r, i) => {
        const id = selected[i]?.id;
        if (id && r.data) map.set(id, r.data);
      });
      return { map, loading: results.some((r) => r.isLoading) };
    },
  });

  const giveRows = useMemo(
    () => give.map((p) => metricsFor(p, details.map.get(p.id), scoring)),
    [give, details.map, scoring],
  );
  const getRows = useMemo(
    () => get.map((p) => metricsFor(p, details.map.get(p.id), scoring)),
    [get, details.map, scoring],
  );

  const byId = useMemo(() => new Map(data.players.map((p) => [p.id, p])), [data.players]);
  const roster = useMemo(
    () =>
      draft.picks
        .filter((p) => p.team === draft.settings.myTeam)
        .map((p) => byId.get(p.playerId))
        .filter((p): p is Player => Boolean(p)),
    [draft.picks, draft.settings.myTeam, byId],
  );
  const needScore = (p: Player) => {
    const count = roster.filter((r) => r.pos === p.pos).length;
    const configured = draft.settings.roster[p.pos] ?? 0;
    return configured > count ? Math.min(12, (configured - count) * 4) : 0;
  };
  const needDelta = useMemo(
    () => get.reduce((s, p) => s + needScore(p), 0) - give.reduce((s, p) => s + needScore(p), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [get, give, roster, draft.settings.roster],
  );

  const giveWeekly = packageWeekly(giveRows);
  const getWeekly = packageWeekly(getRows);
  const basePct = ((getWeekly - giveWeekly) / Math.max(giveWeekly, getWeekly, 0.01)) * 100;
  const adjustedPct = basePct + needDelta;
  const adjustedGrade = grade(adjustedPct);
  const ready = give.length > 0 && get.length > 0;
  const verdict = !ready
    ? "Add players to both sides to analyze this trade."
    : adjustedPct >= 8
      ? "You win this trade — production and roster fit both lean your way."
      : adjustedPct <= -8
        ? "You're giving up more weekly production than you get back."
        : "Fair deal — weekly production is close on both sides.";

  const sum = (rows: Metrics[], key: keyof Metrics) =>
    rows.reduce((s, r) => s + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);

  const statsSeason =
    giveRows.find((r) => r.prevSeason)?.prevSeason ??
    getRows.find((r) => r.prevSeason)?.prevSeason ??
    "Last";

  const overviewRows: CompareRow[] = [
    buildRow("Season Total (proj)", sum(giveRows, "projTotal"), sum(getRows, "projTotal")),
    buildRow("Season Avg. (proj)", sum(giveRows, "projPerWk"), sum(getRows, "projPerWk")),
    buildRow(`${statsSeason} Total`, sum(giveRows, "prevTotal"), sum(getRows, "prevTotal")),
    buildRow(`${statsSeason} Avg.`, sum(giveRows, "prevPerGame"), sum(getRows, "prevPerGame")),
    buildRow("Games Played", sum(giveRows, "prevGames"), sum(getRows, "prevGames"), { digits: 0 }),
  ];

  const bestRank = (rows: Metrics[]) => {
    const ranks = rows.map((r) => r.posRank).filter((n): n is number => Boolean(n));
    return ranks.length ? Math.min(...ranks) : null;
  };
  const lineTotal = (rows: Metrics[], label: string) => {
    const vals = rows
      .flatMap((r) => r.line.filter((l) => l.label === label).map((l) => Number(l.value)))
      .filter((n) => Number.isFinite(n));
    return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
  };
  const labels: string[] = [];
  for (const r of [...giveRows, ...getRows])
    for (const l of r.line) if (!labels.includes(l.label)) labels.push(l.label);

  const statRows: CompareRow[] = [
    buildRow("Position Rank", bestRank(giveRows), bestRank(getRows), {
      lowerBetter: true,
      digits: 0,
      prefix: "#",
    }),
    buildRow("Fantasy Pts", sum(giveRows, "prevTotal"), sum(getRows, "prevTotal")),
    buildRow("Fantasy Pts / Game", sum(giveRows, "prevPerGame"), sum(getRows, "prevPerGame")),
    ...labels.map((label) =>
      buildRow(label, lineTotal(giveRows, label), lineTotal(getRows, label), {
        lowerBetter: LOWER_IS_BETTER.has(label),
      }),
    ),
  ];



  return (
    <main className="mx-auto w-full max-w-5xl px-3 pb-16 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Front Office</p>
          <h1 className="display-title text-4xl">
            Trade <span className="text-primary">Analyzer</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Last season's production + this year's projections, per week and per season.
          </p>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          Scoring: <b className="text-foreground">{scoring}</b> · Team:{" "}
          <b className="text-foreground">{draft.settings.myTeam}</b>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <PlayerPicker
          label="You give"
          players={data.players}
          selected={give}
          onAdd={(p) => setGive((s) => [...s, p])}
          onRemove={(id) => setGive((s) => s.filter((p) => p.id !== id))}
        />
        <PlayerPicker
          label="You receive"
          accent="get"
          players={data.players}
          selected={get}
          onAdd={(p) => setGet((s) => [...s, p])}
          onRemove={(id) => setGet((s) => s.filter((p) => p.id !== id))}
        />
      </div>

      <section className="mt-4 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-4">
          <div
            className={cn(
              "flex h-16 w-16 items-center justify-center rounded-lg border font-display text-3xl font-bold",
              !ready
                ? "border-border text-muted-foreground"
                : adjustedGrade.tone === "good"
                  ? "border-primary bg-primary/10 text-primary"
                  : adjustedGrade.tone === "bad"
                    ? "border-destructive bg-destructive/10 text-destructive"
                    : "border-border bg-surface text-foreground",
            )}
          >
            {ready ? adjustedGrade.letter : "—"}
          </div>
          <div className="flex-1">
            <p className="font-medium">{verdict}</p>
            {ready && (
              <p className="tabnum mt-1 text-xs text-muted-foreground">
                Production: {basePct.toFixed(1)}% · Roster-fit adjustment: {needDelta > 0 ? "+" : ""}
                {needDelta}% · Final: {adjustedPct.toFixed(1)}%
              </p>
            )}
          </div>
        </div>
        {ready && (
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded bg-surface p-2">
              <b className="tabnum block text-sm">{giveWeekly.toFixed(1)}</b>Give pts/wk
            </div>
            <div className="rounded bg-surface p-2">
              <b className="tabnum block text-sm">{getWeekly.toFixed(1)}</b>Get pts/wk
            </div>
            <div className="rounded bg-surface p-2">
              <b className="tabnum block text-sm">
                {needDelta > 0 ? "+" : ""}
                {needDelta}%
              </b>
              Team need
            </div>
          </div>
        )}
      </section>

      <div className="mt-4 flex gap-1">
        {(
          [
            ["overview", "Overview"],
            ["stats", "Stats"],
          ] as const
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
      </div>

      {details.loading && (
        <p className="mt-3 text-center text-xs text-muted-foreground">Loading player stats…</p>
      )}

      <section className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 p-3">
          <SideHead rows={giveRows} title="You give" />
          <span className="self-center rounded-full border border-border bg-surface px-2 py-1 font-display text-[10px] uppercase tracking-widest text-muted-foreground">
            vs
          </span>
          <SideHead rows={getRows} title="You receive" align="right" />
        </div>

        {!ready ? (
          <p className="border-t border-border p-4 text-center text-xs text-muted-foreground">
            Add at least one player to each side to compare.
          </p>
        ) : tab === "overview" ? (
          <CompareTable title="Fantasy Points" rows={overviewRows} />
        ) : (
          <CompareTable title={`${statsSeason} Season Stats`} rows={statRows} />
        )}
      </section>

      <p className="mt-3 text-center text-[11px] text-muted-foreground">
        Green marks the better side. Grades blend this year's projections (65%) with last season's
        per-game production (35%), then adjust for open roster slots configured in the War Room.
      </p>
    </main>
  );
}

function better(a: number, b: number) {
  return a > b && Math.abs(a - b) > 0.05;
}

type CompareRow = {
  label: string;
  give: string;
  get: string;
  giveWin: boolean;
  getWin: boolean;
};

function buildRow(
  label: string,
  a: number | null,
  b: number | null,
  opts: { lowerBetter?: boolean; digits?: number; prefix?: string } = {},
): CompareRow {
  const digits = opts.digits ?? 1;
  const fmt = (v: number | null) =>
    v === null || !Number.isFinite(v) ? "—" : `${opts.prefix ?? ""}${v.toFixed(digits)}`;
  const valid = a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b);
  const aWins = valid && (opts.lowerBetter ? better(b!, a!) : better(a!, b!));
  const bWins = valid && (opts.lowerBetter ? better(a!, b!) : better(b!, a!));
  return { label, give: fmt(a), get: fmt(b), giveWin: aWins, getWin: bWins };
}

function CompareTable({ title, rows }: { title: string; rows: CompareRow[] }) {
  if (!rows.length)
    return (
      <p className="border-t border-border p-4 text-center text-xs text-muted-foreground">
        No stats available for these players.
      </p>
    );
  return (
    <table className="w-full border-t border-border text-sm">
      <thead>
        <tr className="bg-surface">
          <th
            colSpan={3}
            className="px-3 py-2 text-center font-display text-[11px] uppercase tracking-widest text-muted-foreground"
          >
            {title}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-t border-border">
            <td
              className={cn(
                "tabnum w-1/3 px-3 py-2 text-left",
                r.giveWin ? "font-bold text-success" : "text-foreground",
              )}
            >
              {r.give}
            </td>
            <td className="px-2 py-2 text-center text-[11px] uppercase tracking-wide text-muted-foreground">
              {r.label}
            </td>
            <td
              className={cn(
                "tabnum w-1/3 px-3 py-2 text-right",
                r.getWin ? "font-bold text-success" : "text-foreground",
              )}
            >
              {r.get}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SideHead({
  rows,
  title,
  align,
}: {
  rows: Metrics[];
  title: string;
  align?: "right";
}) {
  return (
    <div className={cn("min-w-0", align === "right" && "text-right")}>
      <p className="eyebrow">{title}</p>
      {!rows.length && <p className="mt-1 text-xs text-muted-foreground">No players.</p>}
      <div className="mt-1 space-y-1.5">
        {rows.map((m) => (
          <div
            key={m.player.id}
            className={cn(
              "flex items-center gap-2",
              align === "right" && "flex-row-reverse text-right",
            )}
          >
            <PositionBadge pos={m.player.pos} className="h-5 shrink-0 text-[10px]" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">{m.player.name}</p>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {m.player.pos} · {m.player.team}
                {m.player.bye ? ` · Bye ${m.player.bye}` : ""}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

