import { ActiveLeagueLabel } from "@/components/league/ActiveLeagueLabel";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Undo2, X } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ByeMatrix } from "@/components/draft/ByeMatrix";
import { MyTeamColumn, SideCard } from "@/components/draft/MyTeamColumn";
import { DraftBoard } from "@/components/draft/DraftBoard";
import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { PlayerList } from "@/components/draft/PlayerList";
import { PlayerModal } from "@/components/draft/PlayerModal";
import { SettingsSheet } from "@/components/draft/SettingsSheet";
import { useDraft } from "@/hooks/use-draft";
import {
  nextPicksFor,
  positionNeeds,
  POSITIONS,
  byeMatrix,
  fillRoster,
  posDisplayLabel,
  roundOf,
  SCORING_LABEL,
  teamName,
  type Pick as DraftPick,
  type Player,
  type Pos,
  type Settings,
} from "@/lib/draft";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { loadPlayersCatalog } from "@/lib/players-catalog";
import { cn } from "@/lib/utils";

const playersQuery = queryOptions({
  queryKey: ["players-catalog"],
  queryFn: () => loadPlayersCatalog(),
  staleTime: 1000 * 60 * 30,
});
export const Route = createFileRoute("/draft")({
  // Client catalog only — SSR would burn Fluid Active CPU on every visit.
  ssr: false,
  head: () => ({
    meta: [
      { title: "War Room — The League Office" },
      {
        name: "description",
        content:
          "Fantasy football War Room with ADP, projections, prior-season stats, custom rankings, draft board, roster settings and bye-week matrix.",
      },
    ],
  }),
  component: DraftRoute,
});

function DraftRoute() {
  const { activeLeagueId } = useActiveLeague();
  return <DraftRoom key={activeLeagueId ?? "none"} />;
}
type Tab = "players" | "board" | "team";

const EMPTY_PAYLOAD = { season: "", updatedAt: 0, players: [] as Player[] };

function DraftRoom() {
  // Sleeper catalog is downloaded by the browser once per day and cached
  // locally, so search / filters / scrolling never touch the network.
  const cache = useSleeperPlayers();
  // Server loader is only a fallback when the direct Sleeper fetch fails.
  const fallback = useQuery({ ...playersQuery, enabled: Boolean(cache.error) && !cache.data });
  const data = cache.data ?? fallback.data ?? EMPTY_PAYLOAD;
  const syncing = !cache.data && (cache.loading || fallback.isLoading);
  const draft = useDraft();
  const [tab, setTab] = useState<Tab>("players");
  const [openId, setOpenId] = useState<string | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const [headerH, setHeaderH] = useState(0);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight));
    ro.observe(el);
    setHeaderH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  const byId = useMemo(
    () => new Map<string, Player>(data.players.map((p) => [p.id, p])),
    [data.players],
  );
  const { settings, picks, currentOverall, onTheClock, complete } = draft;
  const myPlayers = useMemo(
    () =>
      picks
        .filter((p) => p.team === settings.myTeam)
        .map((p) => byId.get(p.playerId))
        .filter((p): p is Player => Boolean(p)),
    [picks, byId, settings.myTeam],
  );
  const myNeeds = useMemo(
    () => positionNeeds(myPlayers, settings.roster),
    [myPlayers, settings.roster],
  );
  const myCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of myPlayers) c[p.pos] = (c[p.pos] ?? 0) + 1;
    return c;
  }, [myPlayers]);
  const myUpcoming = nextPicksFor(settings.myTeam, currentOverall, settings, 2);
  const untilMyPick = myUpcoming.length ? myUpcoming[0]! - currentOverall : null;
  const lastPick = picks.length ? picks[picks.length - 1]! : null;
  const lastPlayer = lastPick ? byId.get(lastPick.playerId) : undefined;
  return (
    <main
      className="mx-auto flex min-h-screen w-full max-w-shell flex-col"
      style={{ "--wr-header-h": `${headerH}px` } as React.CSSProperties}
    >
      <header
        ref={headerRef}
        className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur"
      >
        <div className="flex items-center justify-between gap-3 px-3 pt-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="display-title text-3xl">
                War <span className="text-primary">Room</span>
              </h1>
              <ActiveLeagueLabel />
            </div>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
              {data.season} · {SCORING_LABEL[settings.scoring]} · {settings.teams} teams ·{" "}
              {settings.rounds} rds
            </p>
          </div>
          <div className="flex items-center gap-2">
            {lastPlayer && lastPick && (
              <button
                onClick={() => setOpenId(lastPlayer.id)}
                className="hidden items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-left transition-colors hover:border-primary sm:flex"
              >
                <PlayerAvatar
                  id={lastPlayer.id}
                  pos={lastPlayer.pos}
                  team={lastPlayer.team}
                  name={lastPlayer.name}
                  className="size-9"
                />
                <span className="min-w-0">
                  <span className="block text-[10px] uppercase tracking-widest text-muted-foreground">
                    Previous pick
                  </span>
                  <span className="block truncate text-xs font-semibold">{lastPlayer.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {teamName(settings, lastPick.team)}
                  </span>
                </span>
              </button>
            )}
            <button
              onClick={draft.undo}
              disabled={!picks.length}
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 font-display text-xs uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              <Undo2 className="size-4" /> Undo pick
            </button>
            <SettingsSheet
              settings={settings}
              update={draft.updateSettings}
              onReset={draft.reset}
              orderLocked={(draft.picks?.length ?? 0) > 0}
            />
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden border-y border-border bg-border">
          <Stat
            label="On the clock"
            value={complete ? "Done" : teamName(settings, onTheClock)}
            highlight={onTheClock === settings.myTeam && !complete}
          />
          <Stat
            label="Pick"
            value={
              complete
                ? `${picks.length}`
                : `${roundOf(currentOverall, settings.teams)}.${(((currentOverall - 1) % settings.teams) + 1)
                    .toString()
                    .padStart(2, "0")}`
            }
          />
          <Stat
            label="Your next"
            value={untilMyPick === null ? "—" : untilMyPick === 0 ? "Now" : `${untilMyPick} away`}
          />
        </div>
        <div className="flex items-center justify-between px-3 pt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <span>
            {cache.error
              ? "Local cache unavailable — server fallback"
              : cache.fetchedAt
                ? `Player cache · ${new Date(cache.fetchedAt).toLocaleDateString()}`
                : "Player cache · syncing"}
          </span>
          <button
            type="button"
            onClick={cache.resync}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Resync
          </button>
        </div>
        <nav className="flex gap-1 px-3 py-2">
          {(
            [
              ["players", "Available Players"],
              ["board", "Draft Board"],
              ["team", "My Team"],
            ] as [Tab, string][]
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
      <div
        className={cn(
          "flex-1 gap-3 px-0 py-3 lg:px-3",
          tab === "team" && "md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] md:items-start",
          tab === "players" && "md:grid md:grid-cols-[280px_minmax(0,1fr)] md:items-start",
        )}
      >
        {tab === "players" && (
          <aside className="hidden md:sticky md:top-[calc(var(--wr-header-h,0px)+0.75rem)] md:block md:min-w-[280px] md:shrink-0 md:h-[calc(100vh-var(--wr-header-h,0px)-1.5rem)] md:overflow-hidden">
            <SideCard fit title="My Team" subtitle={teamName(settings, settings.myTeam)}>
              <MyTeamColumn
                settings={settings}
                players={myPlayers}
                picks={picks}
                onOpen={setOpenId}
                fit
              />
            </SideCard>
          </aside>
        )}

        {tab === "team" && (
          <div className="mb-3 md:mb-0 md:sticky md:top-[calc(var(--wr-header-h,0px)+0.75rem)]">
            <RosterAnalysisPanel players={myPlayers} settings={settings} />
          </div>
        )}

        <div className="flex min-w-0 flex-col gap-3">
          {tab === "team" && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 bg-slate-50/80 px-3 py-2">
                <div className="font-display text-sm uppercase tracking-widest text-slate-900">
                  My Team
                </div>
                <div className="text-[11px] text-slate-500">
                  {teamName(settings, settings.myTeam)}
                </div>
              </div>
              <div className="p-2">
                <MyTeamColumn
                  settings={settings}
                  players={myPlayers}
                  picks={picks}
                  onOpen={setOpenId}
                  showProj
                  showHeader
                  injuryBesideName
                />
              </div>
            </div>
          )}


          {tab === "players" && syncing && (
            <div className="space-y-2 px-3 py-6">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Syncing player database…
              </p>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-md bg-muted/40" />
              ))}
            </div>
          )}
          {tab === "players" && !syncing && (
            <PlayerList
              players={data.players}
              draftedIds={draft.draftedIds}
              watchIds={draft.watchIds}
              counts={myCounts}
              needs={myNeeds}
              customOrder={draft.customOrder}
              settings={settings}
              currentOverall={currentOverall}
              onDraft={draft.draftPlayer}
              onToggleWatch={draft.toggleWatch}
              onReorder={draft.setCustomOrder}
              onUndo={draft.undo}
              canUndo={picks.length > 0}
              onOpenPlayer={setOpenId}
            />
          )}{" "}
          {tab === "board" && <DraftBoard settings={settings} picks={picks} byId={byId} />}
        </div>
      </div>
      <footer className="border-t border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
        ADP, projections and prior-season stats are sourced from Sleeper's pipeline API. Player
        detail pages provide deeper news, injury and team context.
      </footer>
      <PlayerModal
        id={openId}
        onClose={() => setOpenId(null)}
        onSelectPlayer={setOpenId}
        showDraftActions
        draftRosterLabel={null}
      />
    </main>
  );
}
function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn("bg-surface px-3 py-2", highlight && "bg-primary/15")}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div
        className={cn(
          "tabnum font-display text-lg leading-tight font-semibold",
          highlight && "text-primary",
        )}
      >
        {value}
      </div>
    </div>
  );
}

const POS_BAR_CLASS: Record<string, string> = {
  QB: "bg-qb",
  RB: "bg-rb",
  WR: "bg-wr",
  TE: "bg-te",
  K: "bg-k",
  DEF: "bg-def",
  FLEX: "bg-primary",
  SUPER_FLEX: "bg-primary",
};

function RosterAnalysisPanel({
  players,
  settings,
}: {
  players: Player[];
  settings: Settings;
}) {
  const slots = fillRoster(players, settings.roster);
  const starterSlots = slots.filter((s) => s.slot !== "BN");
  const unfilledStarters = starterSlots.filter((s) => !s.player);

  // Dedicated slots + a single FLEX row (do not add FLEX into every flex position).
  const tierKeys: Array<Pos | "FLEX" | "SUPER_FLEX"> = [
    ...POSITIONS.filter((pos) => (settings.roster[pos] ?? 0) > 0),
    ...((settings.roster.FLEX ?? 0) > 0 ? (["FLEX"] as const) : []),
    ...((settings.roster.SUPER_FLEX ?? 0) > 0 ? (["SUPER_FLEX"] as const) : []),
  ];
  const tiers = tierKeys.map((key) => {
    const required =
      key === "FLEX"
        ? settings.roster.FLEX
        : key === "SUPER_FLEX"
          ? settings.roster.SUPER_FLEX ?? 0
          : settings.roster[key];
    const filled = starterSlots.filter((s) => s.slot === key && s.player).length;
    const pct = required > 0 ? Math.min(100, Math.round((filled / required) * 100)) : 0;
    return {
      key,
      label: posDisplayLabel(key),
      required,
      filled,
      pct,
      complete: filled >= required,
    };
  });

  const alerts: { level: "critical" | "warn" | "ok"; text: string }[] = [];
  const { weeks, unknown } = byeMatrix(players);
  const crowdedWeeks = weeks.filter((w) => w.conflict);

  if (!players.length) {
    // Single empty-state note — skip per-slot Critical spam before any picks.
    alerts.push({ level: "warn", text: "No players drafted yet." });
  } else {
    for (const t of tiers) {
      if (!t.complete) {
        alerts.push({
          level: "critical",
          text: `${t.label} starting slots unfilled — ${t.filled}/${t.required} rostered`,
        });
      }
    }
    for (const w of crowdedWeeks) {
      alerts.push({
        level: "warn",
        text: `Week ${w.week} bye cluster — ${w.players.length} players idle (${w.players.map((p) => posDisplayLabel(p.pos)).join(", ")})`,
      });
    }
    if (unknown.length) {
      alerts.push({
        level: "warn",
        text: `Bye week unknown for ${unknown.map((p) => p.name).join(", ")}`,
      });
    }
    if (alerts.length === 0 && unfilledStarters.length === 0) {
      alerts.push({ level: "ok", text: "Starting lineup filled with no bye clusters." });
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50/80 px-3 py-2">
        <div className="font-display text-sm uppercase tracking-widest text-slate-900">
          Roster Analysis
        </div>
        <div className="text-[11px] text-slate-500">
          Depth, bye weeks, and lineup gaps
        </div>
      </div>

      <div className="grid gap-5 p-3">
        <section>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h3 className="font-display text-xs uppercase tracking-widest text-slate-500">
              Bye weeks
            </h3>
            <span className="tabnum text-xs text-slate-500">
              {crowdedWeeks.length
                ? `${crowdedWeeks.length} crowded`
                : players.length
                  ? "No conflicts"
                  : ""}
            </span>
          </div>
          {players.length ? (
            <ByeMatrix players={players} layout="column" hideTitle />
          ) : (
            <p className="py-2 text-center text-xs text-slate-500">
              Draft players to see bye weeks.
            </p>
          )}
        </section>

        <section>
          <h3 className="mb-2 font-display text-xs uppercase tracking-widest text-slate-500">
            Position depth
          </h3>
          <ul className="space-y-2.5">
            {tiers.map((t) => (
              <li key={t.key} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold text-slate-800">{t.label}</span>
                  <span className={cn(t.complete ? "text-slate-500" : "font-semibold text-red-600")}>
                    {t.filled}/{t.required} starters
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      t.complete ? (POS_BAR_CLASS[t.key] ?? "bg-primary") : "bg-red-500",
                    )}
                    style={{ width: `${t.pct}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="mb-2 font-display text-xs uppercase tracking-widest text-slate-500">
            Notes
          </h3>
          <ul className="space-y-1.5 text-[12px] leading-snug">
            {alerts.map((a, i) => (
              <li
                key={i}
                className={cn(
                  "rounded-md border-l-4 px-2.5 py-1.5",
                  a.level === "critical"
                    ? "border-l-red-500 bg-red-50 text-slate-800"
                    : a.level === "warn"
                      ? "border-l-amber-500 bg-amber-50 text-slate-800"
                      : "border-l-blue-600 bg-blue-50 text-slate-800",
                )}
              >
                <span
                  className={cn(
                    "mr-1.5 font-semibold",
                    a.level === "critical"
                      ? "text-red-700"
                      : a.level === "warn"
                        ? "text-amber-700"
                        : "text-blue-700",
                  )}
                >
                  {a.level === "critical" ? "Critical" : a.level === "warn" ? "Warning" : "OK"}
                </span>
                <span className="text-slate-700">{a.text}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
