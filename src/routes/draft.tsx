import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Undo2, X } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ByeMatrix } from "@/components/draft/ByeMatrix";
import { DraftBoard } from "@/components/draft/DraftBoard";
import { DraftSuggestions } from "@/components/draft/DraftSuggestions";
import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { PlayerList } from "@/components/draft/PlayerList";
import { PlayerModal } from "@/components/draft/PlayerModal";
import { RosterPanel } from "@/components/draft/RosterPanel";
import { SettingsSheet } from "@/components/draft/SettingsSheet";
import { useDraft } from "@/hooks/use-draft";
import {
  fillRoster,
  nextPicksFor,
  positionNeeds,
  roundOf,
  SCORING_LABEL,
  teamName,
  type Pick as DraftPick,
  type Player,
  type Settings,
} from "@/lib/draft";
import { getPlayers } from "@/lib/players.functions";
import { cn } from "@/lib/utils";

const playersQuery = queryOptions({
  queryKey: ["players"],
  queryFn: () => getPlayers(),
  staleTime: 1000 * 60 * 30,
});
export const Route = createFileRoute("/draft")({
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
  loader: ({ context }) => {
    void context.queryClient.ensureQueryData(playersQuery);
  },
  component: DraftRoom,
});
type Tab = "players" | "board" | "team";
function DraftRoom() {
  const { data } = useSuspenseQuery(playersQuery);
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
      className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col"
      style={{ "--wr-header-h": `${headerH}px` } as React.CSSProperties}
    >
      <header
        ref={headerRef}
        className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur"
      >
        <div className="flex items-center justify-between gap-3 px-3 pt-3">
          <div>
            <h1 className="display-title text-3xl">
              War <span className="text-primary">Room</span>
            </h1>
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
              link={draft.link}
              onApplyLeague={draft.applyLeague}
              onUnlinkLeague={draft.unlinkLeague}
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
                : `${currentOverall} · R${roundOf(currentOverall, settings.teams)}`
            }
          />
          <Stat
            label="Your next"
            value={untilMyPick === null ? "—" : untilMyPick === 0 ? "Now" : `${untilMyPick} away`}
          />
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
          tab === "team" && "md:grid md:grid-cols-[280px_minmax(0,1fr)] md:items-start",
          tab === "team" && "lg:grid-cols-[280px_minmax(0,1fr)_240px]",
          tab === "players" && "md:grid md:grid-cols-[280px_minmax(0,1fr)] md:items-start",
        )}
      >
        {tab !== "board" && (
          <aside className="hidden md:sticky md:top-[calc(var(--wr-header-h,0px)+0.75rem)] md:block md:min-w-[280px] md:shrink-0 md:max-h-[calc(100vh-var(--wr-header-h,0px)-1.5rem)]">
            {tab === "team" ? (
              <SideCard title="BYE WEEK MATRIX">
                {myPlayers.length ? (
                  <ByeMatrix players={myPlayers} layout="column" />
                ) : (
                  <p className="p-3 text-center text-xs text-muted-foreground">
                    Draft players to see bye weeks.
                  </p>
                )}
              </SideCard>
            ) : (
              <SideCard title="My Team" subtitle={teamName(settings, settings.myTeam)}>
                <MyTeamColumn
                  settings={settings}
                  players={myPlayers}
                  picks={picks}
                  onOpen={setOpenId}
                />
              </SideCard>
            )}
          </aside>
        )}

        <div className="flex min-w-0 flex-col">
          {tab === "players" && (
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
          {tab === "board" && <DraftBoard settings={settings} picks={picks} byId={byId} />}{" "}
          {tab === "team" && (
            <RosterPanel settings={settings} picks={picks} byId={byId} team={settings.myTeam} />
          )}
        </div>
        {tab === "team" && (
          <aside className="hidden lg:sticky lg:top-[calc(var(--wr-header-h,0px)+0.75rem)] lg:block lg:max-h-[calc(100vh-var(--wr-header-h,0px)-1.5rem)]">
            <SideCard title="Suggested Picks" subtitle="Best value for your roster">
              <DraftSuggestions
                players={data.players}
                draftedIds={draft.draftedIds}
                needs={myNeeds}
                settings={settings}
                currentOverall={currentOverall}
                onDraft={draft.draftPlayer}
                onOpen={setOpenId}
              />
            </SideCard>
          </aside>
        )}
      </div>
      <footer className="border-t border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
        ADP, projections and prior-season stats are sourced from Sleeper's pipeline API. Player
        detail pages provide deeper news, injury and team context.
      </footer>
      <PlayerModal id={openId} onClose={() => setOpenId(null)} onSelectPlayer={setOpenId} />
    </main>
  );
}
function SideCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex max-h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="font-display text-sm uppercase tracking-widest">{title}</div>
        {subtitle && <div className="text-[11px] text-muted-foreground">{subtitle}</div>}
      </div>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
    </div>
  );
}
function MyTeamColumn({
  settings,
  players,
  picks,
  onOpen,
}: {
  settings: Settings;
  players: Player[];
  picks: DraftPick[];
  onOpen: (id: string) => void;
}) {
  const slots = fillRoster(players, settings.roster);
  const pickByPlayer = useMemo(
    () =>
      picks.reduce<Record<string, DraftPick>>((acc, p) => {
        acc[p.playerId] = p;
        return acc;
      }, {}),
    [picks],
  );
  return (
    <ul className="space-y-1">
      {slots.map((s, i) => (
        <li key={i} className="flex items-center gap-1">
          {s.player ? (
            <button
              onClick={() => onOpen(s.player!.id)}
              className="flex w-full items-center gap-2 rounded border border-border bg-background px-2 py-1.5 text-left hover:border-primary"
            >
              <span className="w-7 shrink-0 font-display text-[10px] uppercase text-muted-foreground">
                {s.slot}
              </span>
              <PlayerAvatar
                id={s.player.id}
                pos={s.player.pos}
                team={s.player.team}
                name={s.player.name}
                className="-ml-1 size-9"
                logoClassName="size-3.5"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold">{s.player.name}</div>
                <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                  <span
                    className="inline-block size-1.5 rounded-full"
                    style={{ backgroundColor: `var(--pos-${s.player.pos.toLowerCase()})` }}
                  />
                  <span>{s.player.pos}</span>
                  {s.player.team ? <span>· {s.player.team}</span> : null}
                  {s.player.bye ? <span>· BYE {s.player.bye}</span> : null}
                </div>
              </div>
              {pickByPlayer[s.player.id] ? (
                <span className="tabnum w-10 text-right text-[10px] font-semibold text-muted-foreground">
                  {(() => {
                    const overall = pickByPlayer[s.player.id]!.overall;
                    const round = roundOf(overall, settings.teams);
                    const pick = ((overall - 1) % settings.teams) + 1;
                    return `${round}.${pick.toString().padStart(2, "0")}`;
                  })()}
                </span>
              ) : null}
            </button>
          ) : (
            <div className="flex flex-1 items-center gap-2 rounded border border-dashed border-border px-2 py-1.5">
              <span className="w-8 shrink-0 font-display text-[10px] uppercase text-muted-foreground">
                {s.slot}
              </span>
              <span className="text-xs text-muted-foreground">Empty</span>
            </div>
          )}
        </li>
      ))}
    </ul>
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
