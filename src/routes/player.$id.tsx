import { queryOptions, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { Check, Plus } from "lucide-react";
import { useState } from "react";

import { useDraft } from "@/hooks/use-draft";
import { getGameLogs, getPlayerBio, getPlayerDetail } from "@/lib/players.functions";
import { cn } from "@/lib/utils";


/* ---------- queries (page-local, not shared with the draft popup) ---------- */

const profileQuery = (id: string) =>
  queryOptions({
    queryKey: ["player", id],
    queryFn: () => getPlayerDetail({ data: { id } }),
    staleTime: 1000 * 60 * 30,
  });

const bioQuery = (id: string) =>
  queryOptions({
    queryKey: ["player-bio", id],
    queryFn: () => getPlayerBio({ data: { id } }),
    staleTime: 1000 * 60 * 60 * 12,
  });

const logsQuery = (id: string) =>
  queryOptions({
    queryKey: ["player-logs", id],
    queryFn: () => getGameLogs({ data: { id } }),
    staleTime: 1000 * 60 * 30,
  });

export const Route = createFileRoute("/player/$id")({
  head: () => ({
    meta: [
      { title: "Player profile — The League Office" },
      {
        name: "description",
        content:
          "ESPN-style player hub with season projections, game logs, injury risk, strength of schedule and team depth chart.",
      },
      { property: "og:title", content: "Player profile — The League Office" },
      {
        property: "og:description",
        content:
          "Projections, game logs, schedule difficulty and injury risk for every draftable fantasy player.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(profileQuery(params.id));
    if (!data) throw notFound();
  },
  component: PlayerHubPage,
});

type TabKey = "overview" | "logs" | "depth";

const TABS: [TabKey, string][] = [
  ["overview", "Overview"],
  ["logs", "Game Logs"],
  ["depth", "Team Depth Chart"],
];

function headshot(id: string, pos: string, team: string) {
  if (pos === "DEF") return `https://sleepercdn.com/images/team_logos/nfl/${(team || "").toLowerCase()}.png`;
  return `https://sleepercdn.com/content/nfl/players/${id}.jpg`;
}

const POS_LABEL: Record<string, string> = {
  QB: "Quarterback",
  RB: "Running Back",
  WR: "Wide Receiver",
  TE: "Tight End",
  K: "Kicker",
  DEF: "Defense / Special Teams",
};

function PlayerHubPage() {
  const { id } = Route.useParams();
  const { data, isLoading } = useQuery(profileQuery(id));
  const { data: bio } = useQuery(bioQuery(id));
  const { watchIds, toggleWatch } = useDraft();
  const [tab, setTab] = useState<TabKey>("overview");

  if (isLoading)
    return <p className="py-24 text-center text-sm text-zinc-500">Loading player hub…</p>;
  if (!data) return <p className="py-24 text-center text-sm text-zinc-500">Player not found.</p>;

  const { player, history, projection, depthChart, sos, injuryRisk, season } = data;
  const teamLogo = player.team
    ? `https://sleepercdn.com/images/team_logos/nfl/${player.team.toLowerCase()}.png`
    : null;
  const watching = watchIds.has(player.id);

  const birth = bio?.birthDate
    ? new Date(`${bio.birthDate}T00:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const meta: [string, string][] = [
    ["HT/WT", bio?.height && bio?.weight ? `${bio.height}, ${bio.weight}` : "—"],
    ["Birthdate", birth ? `${birth}${player.age ? ` (${player.age})` : ""}` : player.age ? `Age ${player.age}` : "—"],
    ["College", bio?.college ?? "—"],
    ["Draft Info", bio?.draft ?? (player.exp !== null ? `${player.exp} yr experience` : "—")],
    ["Status", player.injury ?? bio?.status ?? "Active"],
  ];

  return (
    <main className="min-h-screen w-full bg-white">
      {/* ---- full-width identity banner ---- */}
      <header className="w-full border-b border-zinc-200 bg-gradient-to-b from-zinc-50 to-white">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:flex-row sm:items-start">
          <div className="relative size-32 shrink-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm sm:size-40">
            <img
              src={headshot(player.id, player.pos, player.team)}
              alt={player.name}
              className="size-full object-cover object-top"
              onError={(e) => {
                e.currentTarget.style.visibility = "hidden";
              }}
            />
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-4 sm:flex-row sm:justify-between">
            {/* identity stack */}
            <div className="min-w-0">
              <h1 className="display-title text-4xl leading-tight text-zinc-950 sm:text-5xl">
                {player.name}
              </h1>
              <p className="mt-1 font-display text-lg font-bold uppercase tracking-widest text-zinc-500">
                <span className="text-zinc-900">#{bio?.number ?? 0}</span>{" "}
                {POS_LABEL[player.pos] ?? player.pos}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {teamLogo && <img src={teamLogo} alt="" className="size-6" loading="lazy" />}
                <span className="font-display text-sm font-bold uppercase tracking-widest text-blue-600">
                  {player.team} • {player.pos}
                </span>
                <span className="tabnum rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-600">
                  #{player.rank.half} overall
                </span>
              </div>
              <button
                type="button"
                onClick={() => toggleWatch(player.id)}
                className={cn(
                  "mt-3 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold text-white transition-all",
                  watching ? "bg-zinc-800 hover:bg-zinc-900" : "bg-blue-600 hover:bg-blue-700",
                )}
              >
                {watching ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
                {watching ? "Watching" : "Watch Player"}
              </button>
            </div>

            {/* metadata list */}
            <dl className="mt-2 space-y-1 text-sm text-zinc-500 sm:min-w-56 sm:text-right">
              {meta.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-6 sm:justify-end">
                  <dt className="font-semibold uppercase tracking-wide text-zinc-400 text-[11px] self-center">
                    {label}
                  </dt>
                  <dd className="tabnum text-zinc-700">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </header>


      <div className="mx-auto w-full max-w-7xl px-4 py-8">
        {/* ---- line tabs ---- */}
        <nav className="mb-6 flex w-full items-center gap-6 border-b border-zinc-200 pb-2 text-sm font-bold text-zinc-500">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "-mb-2 pb-2 uppercase tracking-wide transition-colors hover:text-zinc-800",
                tab === key && "border-b-2 border-blue-600 text-blue-600",
              )}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="space-y-8 lg:col-span-2">
            {tab === "overview" && (
              <>
                <Module title={`${season} projection`}>
                  <StatTable
                    head={["Metric", "Value"]}
                    rows={[
                      ["Projected points (half PPR)", projection.points.half.toFixed(1)],
                      [
                        "Per week",
                        (projection.points.half / 17).toFixed(1),
                      ],
                      ["Standard", projection.points.std.toFixed(1)],
                      ["Full PPR", projection.points.ppr.toFixed(1)],
                      ...projection.line.map(
                        (l) => [l.label, l.value] as [string, string],
                      ),
                    ]}
                  />
                </Module>

                <Module title="Season history">
                  {history.length === 0 ? (
                    <Empty>No prior-season stats on record.</Empty>
                  ) : (
                    <StatTable
                      head={["Season", "GP", "Pts", "Per game", "Pos rank"]}
                      rows={history.map((h) => [
                        h.season,
                        String(h.games),
                        h.points.half.toFixed(1),
                        h.games ? (h.points.half / h.games).toFixed(1) : "—",
                        h.posRank ? `${player.pos}${h.posRank}` : "—",
                      ])}
                    />
                  )}
                </Module>

                {history[0] && history[0].line.length > 0 && (
                  <Module title={`${history[0].season} stat line`}>
                    <StatTable
                      head={["Stat", "Total"]}
                      rows={history[0].line.map((l) => [l.label, l.value])}
                    />
                  </Module>
                )}
              </>
            )}

            {tab === "logs" && <GameLogs id={id} />}

            {tab === "depth" && (
              <Module title={`${player.team} ${player.pos} depth chart`}>
                {depthChart.length === 0 ? (
                  <Empty>No teammates found.</Empty>
                ) : (
                  <StatTable
                    head={["Player", "Proj", "ADP", "Status"]}
                    rows={depthChart.map((d) => [
                      d.name,
                      d.proj.toFixed(1),
                      d.adp < 900 ? d.adp.toFixed(1) : "—",
                      d.injury ?? "Active",
                    ])}
                    highlightRow={depthChart.findIndex((d) => d.id === player.id)}
                    linkRow={(i) => depthChart[i]!.id}
                  />
                )}
              </Module>
            )}
          </div>

          {/* ---- sidebar widgets ---- */}
          <aside className="space-y-4 self-start rounded-xl border border-zinc-200 bg-zinc-50 p-4 lg:col-span-1">
            <Widget title="Injury risk">
              <div className="flex items-baseline justify-between">
                <span
                  className={cn(
                    "font-display text-xl uppercase",
                    injuryRisk.label === "High"
                      ? "text-red-600"
                      : injuryRisk.label === "Moderate"
                        ? "text-amber-600"
                        : "text-emerald-600",
                  )}
                >
                  {injuryRisk.label}
                </span>
                <span className="tabnum text-sm text-zinc-500">{injuryRisk.score}/100</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-zinc-200">
                <div className="h-full bg-blue-600" style={{ width: `${injuryRisk.score}%` }} />
              </div>
              <ul className="mt-2 space-y-1 text-xs text-zinc-500">
                {injuryRisk.factors.map((f) => (
                  <li key={f}>· {f}</li>
                ))}
              </ul>
            </Widget>

            <Widget title={`Strength of schedule vs ${player.pos}`}>
              {!sos ? (
                <p className="text-xs text-zinc-500">Schedule data unavailable.</p>
              ) : (
                <>
                  <div className="flex items-baseline justify-between">
                    <span className="font-display text-xl text-zinc-900">{sos.grade}</span>
                    <span className="tabnum text-[11px] text-zinc-500">
                      avg opp rank {sos.rank ?? "—"}/32
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-6 gap-1">
                    {sos.opponents.map((o) => (
                      <div
                        key={o.week}
                        className={cn(
                          "rounded border border-zinc-200 bg-white px-1 py-1 text-center",
                          o.rank !== null && o.rank <= 10 && "bg-red-50 border-red-200",
                          o.rank !== null && o.rank >= 23 && "bg-emerald-50 border-emerald-200",
                        )}
                      >
                        <div className="text-[9px] uppercase text-zinc-400">W{o.week}</div>
                        <div className="tabnum text-[11px] font-semibold text-zinc-800">{o.opp}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Widget>

            <Widget title={`${player.team} ${player.pos} depth`}>
              {depthChart.length === 0 ? (
                <p className="text-xs text-zinc-500">No teammates found.</p>
              ) : (
                <ol className="space-y-1">
                  {depthChart.slice(0, 6).map((d, i) => (
                    <li key={d.id}>
                      <Link
                        to="/player/$id"
                        params={{ id: d.id }}
                        className={cn(
                          "flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-white",
                          d.id === player.id && "bg-white font-semibold text-blue-600",
                        )}
                      >
                        <span className="tabnum w-4 text-xs text-zinc-400">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate">{d.name}</span>
                        <span className="tabnum text-xs text-zinc-500">{d.proj.toFixed(1)}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </Widget>
          </aside>
        </div>
      </div>
    </main>
  );
}

function GameLogs({ id }: { id: string }) {
  const { data, isLoading } = useQuery(logsQuery(id));
  if (isLoading) return <Empty>Loading game logs…</Empty>;
  if (!data || data.logs.length === 0) return <Empty>No game logs recorded yet.</Empty>;

  const statLabels = data.logs[0]!.line.map((l) => l.label);
  return (
    <Module title={`${data.season} game log`}>
      <StatTable
        head={["Wk", "Opp", "Pts", ...statLabels]}
        rows={data.logs.map((g) => [
          String(g.week),
          g.opp ?? "—",
          g.points.half.toFixed(1),
          ...statLabels.map((label) => g.line.find((l) => l.label === label)?.value ?? "—"),
        ])}
      />
    </Module>
  );
}

function Module({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-widest text-zinc-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Widget({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3">
      <h3 className="mb-2 font-display text-[11px] font-bold uppercase tracking-widest text-zinc-400">
        {title}
      </h3>
      {children}
    </div>
  );
}

function StatTable({
  head,
  rows,
  highlightRow,
  linkRow,
}: {
  head: string[];
  rows: (string | number)[][];
  highlightRow?: number;
  linkRow?: (index: number) => string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-zinc-50 text-left text-[11px] uppercase tracking-widest text-zinc-400">
            {head.map((h, i) => (
              <th key={h} className={cn("px-3 py-2 font-semibold", i > 0 && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className={cn(
                "border-b border-zinc-100 last:border-0",
                highlightRow === i && "bg-blue-50/60",
              )}
            >
              {r.map((cell, j) => (
                <td
                  key={j}
                  className={cn(
                    "px-3 py-2 text-zinc-700",
                    j === 0 ? "font-medium text-zinc-900" : "tabnum text-right",
                  )}
                >
                  {j === 0 && linkRow ? (
                    <Link
                      to="/player/$id"
                      params={{ id: linkRow(i) }}
                      className="hover:text-blue-600"
                    >
                      {cell}
                    </Link>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500">
      {children}
    </p>
  );
}
