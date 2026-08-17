import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { PlayerPicker } from "@/components/league/PlayerPicker";
import type { Player } from "@/lib/draft";
import { evaluateTrade } from "@/lib/evaluate";
import { getPlayers } from "@/lib/players.functions";
import { cn } from "@/lib/utils";

const playersQuery = queryOptions({
  queryKey: ["players"],
  queryFn: () => getPlayers(),
  staleTime: 1000 * 60 * 30,
});

export const Route = createFileRoute("/trade")({
  head: () => ({
    meta: [
      { title: "Trade Evaluator — DraftRoom" },
      {
        name: "description",
        content:
          "Grade fantasy football trades instantly. Add players to each side and see value, winner and a letter grade.",
      },
      { property: "og:title", content: "Trade Evaluator — DraftRoom" },
      {
        property: "og:description",
        content: "Instant letter grades for any fantasy football trade package.",
      },
    ],
  }),
  loader: ({ context }) => {
    void context.queryClient.ensureQueryData(playersQuery);
  },
  component: TradePage,
});

function TradePage() {
  const { data } = useSuspenseQuery(playersQuery);
  const [give, setGive] = useState<Player[]>([]);
  const [get, setGet] = useState<Player[]>([]);

  const result = useMemo(() => evaluateTrade(give, get), [give, get]);
  const ready = give.length > 0 && get.length > 0;

  return (
    <main className="mx-auto w-full max-w-4xl px-3 pb-16 pt-6">
      <h1 className="display-title text-3xl">Trade Evaluator</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Half-PPR values from live ADP and {data.season} projections.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <PlayerPicker
          label="You give"
          players={data.players}
          selected={give}
          onAdd={(p) => setGive((s) => [...s, p])}
          onRemove={(id) => setGive((s) => s.filter((p) => p.id !== id))}
        />
        <PlayerPicker
          label="You get"
          accent="get"
          players={data.players}
          selected={get}
          onAdd={(p) => setGet((s) => [...s, p])}
          onRemove={(id) => setGet((s) => s.filter((p) => p.id !== id))}
        />
      </div>

      <section className="mt-4 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-4">
          <div
            className={cn(
              "flex h-16 w-16 items-center justify-center rounded-lg border font-display text-3xl font-bold",
              !ready
                ? "border-border text-muted-foreground"
                : result.grade.tone === "good"
                  ? "border-primary bg-primary/10 text-primary"
                  : result.grade.tone === "bad"
                    ? "border-destructive bg-destructive/10 text-destructive"
                    : "border-border bg-surface text-foreground",
            )}
          >
            {ready ? result.grade.letter : "—"}
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">{result.verdict}</p>
            {ready && (
              <p className="tabnum mt-1 text-xs text-muted-foreground">
                Give {result.give} · Get {result.get} · Net{" "}
                {result.diff > 0 ? "+" : ""}
                {result.diff} ({result.diffPct > 0 ? "+" : ""}
                {result.diffPct.toFixed(1)}%)
              </p>
            )}
          </div>
        </div>

        {ready && (
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-surface">
            <div
              className="h-full bg-primary transition-all"
              style={{
                width: `${(result.get / Math.max(1, result.get + result.give)) * 100}%`,
              }}
            />
          </div>
        )}
      </section>
    </main>
  );
}
