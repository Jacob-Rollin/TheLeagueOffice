import { useDeferredValue, useMemo, useState, startTransition } from "react";
import { FilePlus2, Search, Star } from "lucide-react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import {
  fillRoster,
  posDisplayLabel,
  roundOf,
  teamName,
  value,
  type Pick,
  type Player,
  type Pos,
  type Settings,
} from "@/lib/draft";
import { cn } from "@/lib/utils";

import { POS_DOT, posCellClass } from "./posCellStyles";
import { pickLabelForOverall } from "./MobileMockDraftBoard";

type SheetTab = "players" | "queue" | "team";

const POS_FILTERS: Array<"ALL" | Pos> = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"];

export function MobileMockDraftSheet({
  tab,
  onTabChange,
  settings,
  available,
  queuedPlayers,
  watchIds,
  draftedIds,
  picks,
  byId,
  myTurn,
  myCounts,
  currentOverall,
  nextUserOverall,
  queueAutopickOn,
  onQueueAutopickChange,
  rosterTeam,
  onRosterTeamChange,
  onDraft,
  onToggleQueue,
  onOpenPlayer,
}: {
  tab: SheetTab;
  onTabChange: (t: SheetTab) => void;
  settings: Settings;
  available: Player[];
  queuedPlayers: Player[];
  watchIds: Set<string>;
  draftedIds: Set<string>;
  picks: Pick[];
  byId: Map<string, Player>;
  myTurn: boolean;
  myCounts: Record<string, number>;
  currentOverall: number;
  nextUserOverall: number | null;
  queueAutopickOn: boolean;
  onQueueAutopickChange: (on: boolean) => void;
  rosterTeam: number;
  onRosterTeamChange: (t: number) => void;
  onDraft: (id: string) => void;
  onToggleQueue: (id: string) => void;
  onOpenPlayer: (id: string) => void;
}) {
  return (
    <div className="flex max-h-[48vh] min-h-[38vh] flex-col rounded-t-2xl border-t border-m-border bg-m-sheet shadow-[0_-8px_24px_rgba(0,0,0,0.25)]">
      <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-m-border" aria-hidden />
      <div className="flex items-end gap-1 border-b border-m-border px-2 pt-1">
        {(
          [
            ["players", "Players"],
            ["queue", queuedPlayers.length ? `Queue (${queuedPlayers.length})` : "Queue"],
            ["team", "Team"],
          ] as [SheetTab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onTabChange(key)}
            className={cn(
              "flex-1 border-b-2 px-2 py-2.5 font-display text-xs font-bold uppercase tracking-widest transition-colors",
              tab === key
                ? "border-m-accent text-m-accent"
                : "border-transparent text-m-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "players" ? (
        <PlayersPane
          settings={settings}
          available={available}
          watchIds={watchIds}
          myTurn={myTurn}
          myCounts={myCounts}
          nextUserOverall={nextUserOverall}
          onDraft={onDraft}
          onToggleQueue={onToggleQueue}
          onOpenPlayer={onOpenPlayer}
        />
      ) : null}
      {tab === "queue" ? (
        <QueuePane
          queuedPlayers={queuedPlayers}
          settings={settings}
          myTurn={myTurn}
          queueAutopickOn={queueAutopickOn}
          onQueueAutopickChange={onQueueAutopickChange}
          onDraft={onDraft}
          onToggleQueue={onToggleQueue}
          onOpenPlayer={onOpenPlayer}
        />
      ) : null}
      {tab === "team" ? (
        <TeamPane
          settings={settings}
          picks={picks}
          byId={byId}
          draftedIds={draftedIds}
          rosterTeam={rosterTeam}
          onRosterTeamChange={onRosterTeamChange}
          onOpenPlayer={onOpenPlayer}
          currentOverall={currentOverall}
        />
      ) : null}
    </div>
  );
}

function PlayersPane({
  settings,
  available,
  watchIds,
  myTurn,
  myCounts,
  nextUserOverall,
  onDraft,
  onToggleQueue,
  onOpenPlayer,
}: {
  settings: Settings;
  available: Player[];
  watchIds: Set<string>;
  myTurn: boolean;
  myCounts: Record<string, number>;
  nextUserOverall: number | null;
  onDraft: (id: string) => void;
  onToggleQueue: (id: string) => void;
  onOpenPlayer: (id: string) => void;
}) {
  const [pos, setPos] = useState<"ALL" | Pos>("ALL");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return available.filter((p) => {
      if (pos !== "ALL" && p.pos !== pos) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q);
    });
  }, [available, pos, deferredQuery]);

  const projIndex =
    nextUserOverall == null
      ? -1
      : filtered.findIndex((p) => value(p, settings.scoring).adp >= nextUserOverall);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-label="Search players"
          onClick={() => setSearchOpen((o) => !o)}
          className="rounded-lg bg-m-icon-bg p-2 text-m-icon-fg"
        >
          <Search className="size-4" strokeWidth={2.5} />
        </button>
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {POS_FILTERS.map((p) => {
            const drafted =
              p === "ALL"
                ? Object.values(myCounts).reduce((a, b) => a + b, 0)
                : (myCounts[p] ?? 0);
            const totalSlots =
              p === "ALL"
                ? Object.values(settings.roster).reduce((a, b) => a + b, 0)
                : p === "DEF"
                  ? settings.roster.DEF
                  : Number(settings.roster[p as keyof typeof settings.roster] ?? 0);
            return (
              <button
                key={p}
                type="button"
                onClick={() => startTransition(() => setPos(p))}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-wide",
                  pos === p
                    ? "bg-m-card-fg text-m-bg"
                    : "bg-m-chip text-m-chip-fg",
                )}
              >
                {p === "DEF" ? "DST" : p}
                {p === "ALL" || totalSlots > 0 ? ` ${drafted}/${p === "ALL" ? totalSlots : Math.max(totalSlots, drafted)}` : ""}
              </button>
            );
          })}
        </div>
      </div>
      {searchOpen ? (
        <div className="px-3 pb-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search players"
            className="w-full rounded-lg border border-m-border bg-m-card px-3 py-2 text-sm text-m-card-fg outline-none placeholder:text-m-muted"
          />
        </div>
      ) : null}
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {filtered.map((p, i) => (
          <li key={p.id}>
            {projIndex === i && nextUserOverall != null ? (
              <ProjPickLine overall={nextUserOverall} teams={settings.teams} />
            ) : null}
            <PlayerRow
              player={p}
              settings={settings}
              rank={i + 1}
              queued={watchIds.has(p.id)}
              myTurn={myTurn}
              onDraft={onDraft}
              onToggleQueue={onToggleQueue}
              onOpenPlayer={onOpenPlayer}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function QueuePane({
  queuedPlayers,
  settings,
  myTurn,
  queueAutopickOn,
  onQueueAutopickChange,
  onDraft,
  onToggleQueue,
  onOpenPlayer,
}: {
  queuedPlayers: Player[];
  settings: Settings;
  myTurn: boolean;
  queueAutopickOn: boolean;
  onQueueAutopickChange: (on: boolean) => void;
  onDraft: (id: string) => void;
  onToggleQueue: (id: string) => void;
  onOpenPlayer: (id: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-end gap-2 px-4 py-2">
        <span className="text-xs text-m-muted">Auto-pick</span>
        <button
          type="button"
          role="switch"
          aria-checked={queueAutopickOn}
          onClick={() => onQueueAutopickChange(!queueAutopickOn)}
          className={cn(
            "relative h-6 w-11 rounded-full transition-colors",
            queueAutopickOn ? "bg-m-accent" : "bg-m-border",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-5 rounded-full bg-white transition-transform",
              queueAutopickOn ? "left-5" : "left-0.5",
            )}
          />
        </button>
      </div>
      {queuedPlayers.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 pb-8 text-center">
          <span className="inline-flex size-14 items-center justify-center rounded-full bg-m-accent/20 text-m-accent">
            <FilePlus2 className="size-7" strokeWidth={2} />
          </span>
          <p className="font-display text-base font-bold text-m-card-fg">Draft queue is empty</p>
          <p className="text-sm text-m-muted">
            Speed up the draft by adding players to your queue from the players tab.
          </p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {queuedPlayers.map((p, i) => (
            <PlayerRow
              key={p.id}
              player={p}
              settings={settings}
              rank={i + 1}
              queued
              myTurn={myTurn}
              onDraft={onDraft}
              onToggleQueue={onToggleQueue}
              onOpenPlayer={onOpenPlayer}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TeamPane({
  settings,
  picks,
  byId,
  rosterTeam,
  onRosterTeamChange,
  onOpenPlayer,
}: {
  settings: Settings;
  picks: Pick[];
  byId: Map<string, Player>;
  draftedIds: Set<string>;
  rosterTeam: number;
  onRosterTeamChange: (t: number) => void;
  onOpenPlayer: (id: string) => void;
  currentOverall: number;
}) {
  const roster = picks
    .filter((p) => p.team === rosterTeam)
    .map((p) => ({ pick: p, player: byId.get(p.playerId) }))
    .filter((x): x is { pick: Pick; player: Player } => Boolean(x.player));
  const players = roster.map((r) => r.player);
  const slots = fillRoster(players, settings.roster);
  const pickByPlayer = new Map(roster.map((r) => [r.player.id, r.pick]));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-1.5 overflow-x-auto px-3 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {Array.from({ length: settings.teams }, (_, i) => i + 1).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onRosterTeamChange(t)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-wide",
              rosterTeam === t
                ? "bg-m-card-fg text-m-bg"
                : "bg-m-chip text-m-chip-fg",
            )}
          >
            {t === settings.myTeam ? teamName(settings, t) : `Slot ${t}`}
          </button>
        ))}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {slots.map((s, i) => {
          const pick = s.player ? pickByPlayer.get(s.player.id) : undefined;
          return (
            <li
              key={`${s.slot}-${i}`}
              className="flex items-center gap-3 border-b border-m-border py-2.5"
            >
              <span
                className={cn(
                  "inline-flex h-8 min-w-[2.6rem] items-center justify-center rounded-md px-1.5 font-display text-[11px] font-bold uppercase",
                  s.player ? posCellClass(s.player.pos) : "bg-m-chip text-m-chip-fg",
                  !s.player && (POS_DOT[s.slot] ? "" : ""),
                )}
              >
                {s.slot === "DEF" ? "DST" : s.slot === "BN" ? "BN" : s.slot === "SUPER_FLEX" ? "SF" : s.slot === "FLEX" ? "WRT" : s.slot}
              </span>
              {s.player ? (
                <button
                  type="button"
                  onClick={() => onOpenPlayer(s.player!.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <PlayerAvatar
                    id={s.player.id}
                    pos={s.player.pos}
                    team={s.player.team}
                    name={s.player.name}
                    className="size-9"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-m-card-fg">
                      {s.player.name}
                    </span>
                    <span className="block text-[11px] text-m-muted">
                      {posDisplayLabel(s.player.pos)} · {s.player.team}
                      {s.player.bye ? ` (${s.player.bye})` : ""}
                    </span>
                  </span>
                </button>
              ) : (
                <span className="flex-1 text-sm text-m-muted">Empty</span>
              )}
              {pick ? (
                <span className="text-right">
                  <span className="tabnum block rounded-full bg-m-chip px-2 py-0.5 text-xs font-semibold text-m-chip-fg">
                    {pickLabelForOverall(pick.overall, settings.teams)}
                  </span>
                  <span className="mt-0.5 block text-[9px] uppercase text-m-muted">pick</span>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PlayerRow({
  player,
  settings,
  rank,
  queued,
  myTurn,
  onDraft,
  onToggleQueue,
  onOpenPlayer,
}: {
  player: Player;
  settings: Settings;
  rank: number;
  queued: boolean;
  myTurn: boolean;
  onDraft: (id: string) => void;
  onToggleQueue: (id: string) => void;
  onOpenPlayer: (id: string) => void;
}) {
  const v = value(player, settings.scoring);
  return (
    <div className="flex items-center gap-2 border-b border-m-border/70 py-2">
      <button
        type="button"
        disabled={!myTurn}
        onClick={() => onDraft(player.id)}
        className={cn(
          "shrink-0 rounded-full px-3 py-1.5 font-display text-[11px] font-extrabold uppercase tracking-wide",
          myTurn
            ? "bg-m-accent text-m-accent-fg"
            : "bg-m-chip text-m-muted opacity-60",
        )}
      >
        Draft
      </button>
      <button
        type="button"
        onClick={() => onOpenPlayer(player.id)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span className="tabnum w-5 shrink-0 text-center text-xs text-m-muted">{rank}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-m-card-fg">{player.name}</span>
          <span className="block text-[11px] text-m-muted">
            {posDisplayLabel(player.pos)} · {player.team}
            {player.bye ? ` (${player.bye})` : ""}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={queued ? "Remove from queue" : "Add to queue"}
        onClick={() => onToggleQueue(player.id)}
        className={cn(
          "rounded-lg p-1.5",
          queued ? "text-m-accent" : "text-m-muted",
        )}
      >
        <Star className={cn("size-4", queued && "fill-current")} strokeWidth={2.5} />
      </button>
      <div className="w-12 shrink-0 text-right">
        <span className="block text-[9px] uppercase text-m-muted">ADP</span>
        <span className="tabnum block text-xs font-semibold text-m-card-fg">
          {v.adp < 900 ? v.adp.toFixed(1) : "—"}
        </span>
      </div>
      <div className="w-10 shrink-0 text-right">
        <span className="block text-[9px] uppercase text-m-muted">Pts</span>
        <span className="tabnum block text-xs font-semibold text-m-card-fg">
          {v.proj.toFixed(0)}
        </span>
      </div>
    </div>
  );
}

function ProjPickLine({ overall, teams }: { overall: number; teams: number }) {
  return (
    <div className="my-1 flex items-center gap-2 px-1">
      <span className="h-px flex-1 bg-m-accent/70" />
      <span className="font-display text-[10px] font-bold uppercase tracking-wider text-m-accent">
        Proj pick: Round {roundOf(overall, teams)} Overall #{overall}
      </span>
      <span className="h-px flex-1 bg-m-accent/70" />
    </div>
  );
}
