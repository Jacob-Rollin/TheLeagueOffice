import { queryOptions, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";

import { PlayerDetail } from "@/components/draft/PlayerDetail";
import { usePlayerSos, useSosPeerMatrix } from "@/hooks/usePlayerSos";
import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { NFL_TEAMS } from "@/lib/nfl-teams";
import { getNextGame, getPlayerDetail } from "@/lib/players.functions";
import {
  matchupGrade,
  matchupTone,
  playoffWindow,
  positionPercentile,
  strategicOutlook,
  weekSlots,
} from "@/lib/sos-presentation";
import { cn } from "@/lib/utils";

/* ---------- queries (page-local, not shared with the draft popup) ---------- */

const profileQuery = (id: string) =>
  queryOptions({
    queryKey: ["player", id],
    queryFn: () => getPlayerDetail({ data: { id } }),
    staleTime: 1000 * 60 * 30,
  });

const nextGameQuery = (team: string) =>
  queryOptions({
    queryKey: ["player-next-game", team],
    queryFn: () => getNextGame({ data: { team } }),
    staleTime: 1000 * 60 * 60 * 6,
  });

const TEAM_NAME: Record<string, string> = Object.fromEntries(
  NFL_TEAMS.map((t) => [t.id, t.name]),
);

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

/** Dynamic risk bucket routing for the injury telemetry meter. */
function riskTier(score: number): { label: string; text: string; fill: string } {
  if (score >= 70)
    return { label: "HIGH RISK", text: "text-rose-500", fill: "bg-rose-500" };
  if (score >= 35)
    return { label: "MODERATE RISK", text: "text-amber-500", fill: "bg-amber-500" };
  return { label: "LOW RISK", text: "text-emerald-500", fill: "bg-emerald-500" };
}

function PlayerHubPage() {
  const { id } = Route.useParams();
  const { data, isLoading } = useQuery(profileQuery(id));
  const brain = usePlayerBrain();
  const playerSos = usePlayerSos(
    (data ? brain?.[data.player.id] : null) ?? null,
    data?.player.team ?? null,
  );
  const sosPeers = useSosPeerMatrix(data?.player.pos ?? null, brain);

  if (isLoading)
    return <p className="py-24 text-center text-sm text-zinc-500">Loading player hub…</p>;
  if (!data) return <p className="py-24 text-center text-sm text-zinc-500">Player not found.</p>;

  const { player, depthChart, injuryRisk } = data;
  const posDepthChart = depthChart.filter((d) => d.pos === player.pos);
  const brainEntry = brain?.[player.id] ?? null;
  const brainSos = playerSos;
  const percentileLabel = positionPercentile(player.id, player.pos, sosPeers ?? brain, brainSos);
  const tier = riskTier(injuryRisk.score);

  return (
    <main className="w-full min-h-screen bg-slate-50 text-slate-900 overflow-y-auto">
      <div className="mx-auto mt-0 w-full max-w-7xl overflow-visible px-4 pt-0 lg:px-6">
        <div className="grid w-full grid-cols-1 items-start gap-8 overflow-visible pt-0 lg:grid-cols-[1fr_360px] lg:pt-6">
          {/* Left column — mirrors the premium player popup canvas */}
          <div className="relative z-10 flex w-full flex-col items-stretch overflow-visible border-0 bg-transparent p-0 shadow-none">
            <PlayerDetail id={id} showFullProfileLink={false} />
          </div>

          {/* ---- sidebar widgets (unchanged) ---- */}
          <aside className="w-full space-y-4 self-start rounded-xl border border-zinc-200 bg-zinc-50 p-4 lg:w-[360px]">
            <NextGame team={player.team} />

            {player.pos !== "DEF" && (
              <Widget title="Injury risk">
                <div className="flex items-baseline justify-between">
                  <span className={cn("font-display text-xl uppercase", tier.text)}>
                    {tier.label}
                  </span>
                  <span className="tabnum text-sm text-zinc-500">{injuryRisk.score}/100</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded bg-zinc-200">
                  <div
                    className={cn("h-full transition-[width] duration-500", tier.fill)}
                    style={{ width: `${Math.min(100, Math.max(0, injuryRisk.score))}%` }}
                  />
                </div>
                <ul className="mt-2 space-y-1 text-xs text-zinc-500">
                  {player.injury && brainEntry?.injuryType && (
                    <li>
                      · <span className="font-semibold text-zinc-800">CORE DIAGNOSIS:</span>{" "}
                      {brainEntry.injuryType}
                    </li>
                  )}
                  {injuryRisk.factors
                    .filter(
                      (f) =>
                        !f.toLowerCase().includes("currently listed") &&
                        (!player.injury ||
                          f.toLowerCase().trim() !== player.injury.toLowerCase().trim()),
                    )
                    .map((f) => {
                      const lower = f.toLowerCase();
                      const isWorkload =
                        lower.includes("carries") ||
                        lower.includes("touches") ||
                        lower.includes("targets") ||
                        lower.includes("snaps");
                      const label = isWorkload ? "WORKLOAD NOTE" : "HISTORICAL TRACK";
                      return (
                        <li key={f}>
                          · <span className="font-semibold text-zinc-800">{label}:</span> {f}
                        </li>
                      );
                    })}
                  <li>
                    · <span className="font-semibold text-zinc-800">CURRENT DESIGNATION:</span>{" "}
                    {player.injury ?? "Healthy — no designation"}
                  </li>
                </ul>
              </Widget>
            )}

            {player.pos !== "DEF" && (
              <Widget title={`Strength of schedule vs ${player.pos}`}>
                {!brainSos ? (
                  <p className="text-xs text-zinc-500">Schedule data unavailable.</p>
                ) : (
                  <>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0">
                        <p className="font-display text-xl font-bold text-foreground">
                          {matchupGrade(brainSos.rank)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {strategicOutlook(brainSos)}
                        </p>
                      </div>
                      <div className="ml-auto flex flex-col items-end text-right">
                        {percentileLabel && (
                          <span className="text-right text-xs font-medium text-slate-500">
                            {percentileLabel}
                          </span>
                        )}
                        <span className="text-[11px] text-muted-foreground">
                          Playoff Window SoS: {playoffWindow(brainSos)}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-6 gap-1 sm:grid-cols-9">
                      {weekSlots(brainSos.matchups).map((slot) =>
                        slot.matchup ? (
                          <div
                            key={slot.week}
                            className={cn(
                              "flex flex-col items-center justify-center rounded-lg border bg-card p-2 shadow-sm",
                              matchupTone(slot.matchup.rank),
                            )}
                          >
                            <div className="text-[9px] uppercase text-muted-foreground">
                              Week {slot.week}
                            </div>
                            <div className="tabnum text-[11px] font-semibold">
                              {slot.matchup.opp}
                            </div>
                          </div>
                        ) : (
                          <div
                            key={slot.week}
                            className="flex flex-col items-center justify-center rounded-lg border border-border/60 bg-transparent p-2 shadow-sm"
                          >
                            <div className="text-[9px] uppercase text-muted-foreground">
                              Week {slot.week}
                            </div>
                            <div className="tabnum text-[11px] font-semibold text-slate-400">
                              BYE
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  </>
                )}
              </Widget>
            )}

            {player.pos !== "DEF" && (
              <Widget title={`${player.team} ${player.pos} depth`}>
                {posDepthChart.length === 0 ? (
                  <p className="text-xs text-zinc-500">No teammates found.</p>
                ) : (
                  <ol className="space-y-1">
                    {posDepthChart.slice(0, 6).map((d, i) => (
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
                          <span className="tabnum text-xs text-zinc-500">
                            {d.proj.toFixed(1)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                )}
              </Widget>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}

/** Broadcast-style upcoming matchup strip, bound to the player's real NFL team. */
function NextGame({ team }: { team: string }) {
  const { data, isLoading } = useQuery(nextGameQuery(team));
  const logo = (t: string) =>
    `https://sleepercdn.com/images/team_logos/nfl/${(t || "").toLowerCase()}.png`;
  const label = (t: string) => TEAM_NAME[t.toUpperCase()] ?? t;

  if (isLoading)
    return (
      <Widget title="Next game">
        <p className="text-xs text-zinc-500">Loading schedule…</p>
      </Widget>
    );
  if (!data)
    return (
      <Widget title="Next game">
        <p className="text-xs text-zinc-500">No upcoming game scheduled.</p>
      </Widget>
    );

  const home = data.isHome;
  const left = home ? team : data.opponent;
  const right = home ? data.opponent : team;
  const kickoff = data.date
    ? new Date(`${data.date}T17:00:00Z`).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      })
    : `Week ${data.week}`;

  return (
    <Widget title="Next game">
      <div className="flex items-center justify-between gap-3">
        <TeamMark team={left} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <img src={logo(left)} alt="" className="size-10" loading="lazy" />
          <span className="truncate text-xs font-bold uppercase tracking-wide text-zinc-700">
            {label(left)}
          </span>
        </TeamMark>
        <div className="shrink-0 text-center">
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
            Week {data.week}
          </div>
          <div className="mt-1 text-[11px] font-medium text-zinc-500">{kickoff}</div>
        </div>
        <TeamMark team={right} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <img src={logo(right)} alt="" className="size-10" loading="lazy" />
          <span className="truncate text-xs font-bold uppercase tracking-wide text-zinc-700">
            {label(right)}
          </span>
        </TeamMark>
      </div>
    </Widget>
  );
}

function TeamMark({
  team,
  className,
  children,
}: {
  team: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (!team) return <div className={className}>{children}</div>;
  return (
    <Link
      to="/nfl-team/$nflId"
      params={{ nflId: team }}
      className={cn(
        "cursor-pointer border-none bg-transparent p-0 font-inherit text-current no-underline decoration-transparent hover:text-current",
        className,
      )}
    >
      {children}
    </Link>
  );
}

function Widget({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-3">
      <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-zinc-400">
        {title}
      </h3>
      {children}
    </section>
  );
}
