import { createFileRoute } from "@tanstack/react-router";

import {
  ActivityFeed,
  evaluateTransactionType,
  resolveActivityKind,
} from "@/components/dashboard/ActivityFeed";
import { playbookCardClass } from "@/components/playbook/panels";
import { useLeagueActivity } from "@/hooks/useLeagueActivity";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { LeagueActivityEvent } from "@/lib/league.functions";

export const Route = createFileRoute("/playbook/transactions")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Transactions — Playbook" }],
  }),
  component: PlaybookTransactionsPage,
});

/**
 * Mirror of the dashboard ActivityFeed type gate — enforces Sleeper root
 * type codes so IR labels never stick to waiver / free-agent cuts.
 */
function normalizeTransactionEvent(event: LeagueActivityEvent): LeagueActivityEvent {
  const kind = resolveActivityKind(event);
  const evaluated = evaluateTransactionType({
    type:
      kind === "waiver"
        ? "waiver"
        : kind === "free_agent"
          ? "free_agent"
          : kind === "trade"
            ? "trade"
            : kind === "ir"
              ? "ir"
              : event.kind,
    metadata: kind === "ir" ? { to_slot: "IR" } : null,
    adds: Object.fromEntries(
      (event.moves ?? [])
        .filter((m) => m.action === "add")
        .map((m) => [m.playerId, 1]),
    ),
    drops: Object.fromEntries(
      (event.moves ?? [])
        .filter((m) => m.action === "drop" || m.action === "ir")
        .map((m) => [m.playerId, 1]),
    ),
  });

  if (evaluated.isTrade) return { ...event, kind: "trade" };
  if (evaluated.isWaiver) {
    return {
      ...event,
      kind: "waiver",
      moves: (event.moves ?? []).map((m) => ({
        ...m,
        action: m.action === "add" ? "add" : "drop",
      })),
    };
  }
  if (evaluated.isFreeAgent) {
    return {
      ...event,
      kind: "free_agent",
      moves: (event.moves ?? []).map((m) => ({
        ...m,
        action: m.action === "add" ? "add" : "drop",
      })),
    };
  }
  if (evaluated.isActualIRMove) return { ...event, kind: "ir" };

  // Fallback: never leave add/drop actions under an IR heading.
  if (kind !== "ir") return { ...event, kind };
  const hasAddOrDrop = (event.moves ?? []).some(
    (m) => m.action === "add" || m.action === "drop",
  );
  if (hasAddOrDrop) {
    return {
      ...event,
      kind: "free_agent",
      moves: (event.moves ?? []).map((m) => ({
        ...m,
        action: m.action === "add" ? "add" : "drop",
      })),
    };
  }
  return { ...event, kind: "ir" };
}

function PlaybookTransactionsPage() {
  const { events, loading, error } = useLeagueActivity();
  const { data: playersPayload } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const normalized = events.map(normalizeTransactionEvent);

  return (
    <div>
      <header className="mb-4">
        <h1 className="display-title text-3xl">
          League <span className="text-primary">Activity</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live waiver, free agent, trade, and IR moves from the active host league.
        </p>
      </header>

      <section className={playbookCardClass}>
        <ActivityFeed
          events={normalized}
          players={players}
          loading={loading}
          error={error}
          className="rounded-none border-0 bg-transparent p-0"
        />
      </section>
    </div>
  );
}
