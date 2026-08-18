import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Star } from "lucide-react";
import { useMemo, useState } from "react";
import { DraftBoard } from "@/components/draft/DraftBoard";
import { PlayerList } from "@/components/draft/PlayerList";
import { PlayerModal } from "@/components/draft/PlayerModal";
import { PositionBadge } from "@/components/draft/PositionBadge";
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
  value,
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
  const watchPlayers = useMemo(
    () => data.players.filter((p) => draft.watchIds.has(p.id)),
    [data.players, draft.watchIds],
  );
  const myUpcoming = nextPicksFor(settings.myTeam, currentOverall, settings, 2);
  const untilMyPick = myUpcoming.length ? myUpcoming[0]! - currentOverall : null;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
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
          <SettingsSheet settings={settings} update={draft.updateSettings} onReset={draft.reset} />
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
      <div className="flex-1 gap-3 px-0 lg:grid lg:grid-cols-[260px_minmax(0,1fr)_260px] lg:px-3">
        <aside className="hidden lg:block">
          <SideCard title="My Team" subtitle={teamName(settings, settings.myTeam)}>
            <MyTeamColumn settings={settings} players={myPlayers} onOpen={setOpenId} />
          </SideCard>
        </aside>
        <div className="min-w-0">
          {tab === "players" && (
            <PlayerList
              players={data.players}
              draftedIds={draft.draftedIds}
              watchIds={draft.watchIds}
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
        <aside className="hidden lg:block">
          <SideCard title="Watchlist" subtitle={`${watchPlayers.length} players`}>
            <WatchColumn
              settings={settings}
              players={watchPlayers}
              draftedIds={draft.draftedIds}
              onOpen={setOpenId}
              onDraft={draft.draftPlayer}
              onToggleWatch={draft.toggleWatch}
            />
          </SideCard>
        </aside>
      </div>
      <footer className="border-t border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
        ADP, projections and prior-season stats are sourced from the free Sleeper data pipeline.
        Player detail pages provide deeper news, injury and team context.
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
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="sticky top-44 mt-3 rounded-xl border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="font-display text-sm uppercase tracking-widest">{title}</div>
        <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>
      </div>
      <div className="max-h-[calc(100vh-16rem)] overflow-y-auto p-2">{children}</div>
    </div>
  );
}
function MyTeamColumn({
  settings,
  players,
  onOpen,
}: {
  settings: Settings;
  players: Player[];
  onOpen: (id: string) => void;
}) {
  const slots = fillRoster(players, settings.roster);
  return (
    <ul className="space-y-1">
      {slots.map((s, i) => (
        <li key={i}>
          {s.player ? (
            <button
              onClick={() => onOpen(s.player!.id)}
              className="flex w-full items-center gap-2 rounded border border-border bg-background px-2 py-1.5 text-left hover:border-primary"
            >
              <span className="w-8 shrink-0 font-display text-[10px] uppercase text-muted-foreground">
                {s.slot}
              </span>
              <PositionBadge pos={s.player.pos} className="h-5 text-[10px]" />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold">{s.player.name}</span>
              <span className="tabnum text-[10px] text-muted-foreground">
                {value(s.player, settings.scoring).proj.toFixed(0)}
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded border border-dashed border-border px-2 py-1.5">
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
function WatchColumn({
  settings,
  players,
  draftedIds,
  onOpen,
  onDraft,
  onToggleWatch,
}: {
  settings: Settings;
  players: Player[];
  draftedIds: Set<string>;
  onOpen: (id: string) => void;
  onDraft: (id: string) => void;
  onToggleWatch: (id: string) => void;
}) {
  if (!players.length)
    return (
      <p className="p-3 text-center text-xs text-muted-foreground">
        Star players to build your watchlist.
      </p>
    );
  const sorted = [...players].sort(
    (a, b) => value(a, settings.scoring).rank - value(b, settings.scoring).rank,
  );
  return (
    <ul className="space-y-1">
      {sorted.map((p) => {
        const drafted = draftedIds.has(p.id);
        return (
          <li
            key={p.id}
            className={cn(
              "rounded border border-border bg-background px-2 py-1.5",
              drafted && "opacity-50",
            )}
          >
            <button
              onClick={() => onOpen(p.id)}
              className="flex w-full items-center gap-2 text-left"
            >
              <PositionBadge pos={p.pos} className="h-5 text-[10px]" />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold">{p.name}</span>
              <span className="tabnum text-[10px] text-muted-foreground">
                #{value(p, settings.scoring).rank}
              </span>
            </button>
            <div className="mt-1 flex gap-1">
              <button
                disabled={drafted}
                onClick={() => onDraft(p.id)}
                className="flex-1 rounded bg-primary px-2 py-1 font-display text-[10px] uppercase text-primary-foreground disabled:opacity-50"
              >
                {drafted ? "Gone" : "Draft"}
              </button>
              <button
                aria-label={`Unwatch ${p.name}`}
                onClick={() => onToggleWatch(p.id)}
                className="rounded border border-border px-2 py-1 text-muted-foreground hover:text-foreground"
              >
                <Star className="size-3 fill-current" />
              </button>
            </div>
          </li>
        );
      })}
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
