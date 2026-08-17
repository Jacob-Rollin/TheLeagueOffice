import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { DraftBoard } from "@/components/draft/DraftBoard";
import { PlayerList } from "@/components/draft/PlayerList";
import { RosterPanel } from "@/components/draft/RosterPanel";
import { SettingsSheet } from "@/components/draft/SettingsSheet";
import { useDraft } from "@/hooks/use-draft";
import {
  nextPicksFor,
  positionNeeds,
  roundOf,
  SCORING_LABEL,
  teamName,
  type Player,
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
      { title: "DraftRoom — Fantasy Football Draft Tool" },
      {
        name: "description",
        content:
          "Live half-PPR fantasy football draft board with real ADP, projections and last-season stats. Custom teams, rounds and roster positions.",
      },
      { property: "og:title", content: "DraftRoom — Fantasy Football Draft Tool" },
      {
        property: "og:description",
        content:
          "Draft smarter with live ADP, projections and a snake board built for your league settings.",
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

  const byId = useMemo(
    () => new Map<string, Player>(data.players.map((p) => [p.id, p])),
    [data.players],
  );

  const { settings, picks, currentOverall, onTheClock, complete } = draft;
  const myNeeds = useMemo(() => {
    const mine = picks
      .filter((p) => p.team === settings.myTeam)
      .map((p) => byId.get(p.playerId))
      .filter((p): p is Player => Boolean(p));
    return positionNeeds(mine, settings.roster);
  }, [picks, byId, settings.myTeam, settings.roster]);

  const myUpcoming = nextPicksFor(settings.myTeam, currentOverall, settings, 2);
  const untilMyPick = myUpcoming.length ? myUpcoming[0]! - currentOverall : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-3 pt-3">
          <div>
            <h1 className="display-title text-2xl">
              Draft<span className="text-primary">Room</span>
            </h1>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
              {data.season} · {SCORING_LABEL[settings.scoring]} · {settings.teams} teams ·{" "}
              {settings.rounds} rds
            </p>
          </div>
          <SettingsSheet settings={settings} update={draft.updateSettings} onReset={draft.reset} />
        </div>

        <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden border-y border-border bg-border">
          <Stat label="On the clock" value={complete ? "Done" : teamName(settings, onTheClock)} highlight={onTheClock === settings.myTeam && !complete} />
          <Stat
            label="Pick"
            value={complete ? `${picks.length}` : `${currentOverall} · R${roundOf(currentOverall, settings.teams)}`}
          />
          <Stat
            label="Your next"
            value={
              untilMyPick === null
                ? "—"
                : untilMyPick === 0
                  ? "Now"
                  : `${untilMyPick} away`
            }
          />
        </div>

        <nav className="flex gap-1 px-3 py-2">
          {(
            [
              ["players", "Players"],
              ["board", "Board"],
              ["team", "My team"],
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

      <div className="flex-1">
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
          />
        )}
        {tab === "board" && <DraftBoard settings={settings} picks={picks} byId={byId} />}
        {tab === "team" && (
          <RosterPanel settings={settings} picks={picks} byId={byId} team={settings.myTeam} />
        )}
      </div>

      <footer className="border-t border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
        ADP, projections and prior-season stats from the free Sleeper API. Tap a player to assign
        them to the team on the clock.
      </footer>
    </main>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
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
