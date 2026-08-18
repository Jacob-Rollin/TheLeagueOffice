import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PlayerPicker } from "@/components/league/PlayerPicker";
import type { Player } from "@/lib/draft";
import { evaluateTrade, grade } from "@/lib/evaluate";
import { getPlayers } from "@/lib/players.functions";
import { cn } from "@/lib/utils";
import { useDraft } from "@/hooks/use-draft";

const playersQuery = queryOptions({ queryKey: ["players"], queryFn: () => getPlayers(), staleTime: 1000 * 60 * 30 });
export const Route = createFileRoute("/trade")({
  head: () => ({ meta: [
    { title: "Trade Evaluator — The League Office" },
    { name: "description", content: "Evaluate fantasy football trades using player value, ADP, projections and your roster's positional needs." },
  ]}),
  loader: ({ context }) => { void context.queryClient.ensureQueryData(playersQuery); }, component: TradePage,
});
function TradePage() {
  const { data } = useSuspenseQuery(playersQuery); const draft = useDraft(); const [give, setGive] = useState<Player[]>([]); const [get, setGet] = useState<Player[]>([]);
  const byId = useMemo(() => new Map(data.players.map((p) => [p.id, p])), [data.players]);
  const roster = useMemo(() => draft.picks.filter((p) => p.team === draft.settings.myTeam).map((p) => byId.get(p.playerId)).filter((p): p is Player => Boolean(p)), [draft.picks, draft.settings.myTeam, byId]);
  const needScore = (p: Player) => { const count = roster.filter((r) => r.pos === p.pos).length; const configured = draft.settings.roster[p.pos] ?? 0; return configured > count ? Math.min(12, (configured - count) * 4) : 0; };
  const base = useMemo(() => evaluateTrade(give, get, draft.settings.scoring), [give, get, draft.settings.scoring]);
  const needDelta = useMemo(() => get.reduce((s, p) => s + needScore(p), 0) - give.reduce((s, p) => s + needScore(p), 0), [get, give, roster, draft.settings.roster]);
  const adjustedPct = base.diffPct + needDelta;
  const adjustedGrade = grade(adjustedPct);
  const ready = give.length > 0 && get.length > 0;
  const verdict = !ready ? "Add players to both sides to grade this trade." : adjustedPct >= 8 ? "You win this trade — value and roster fit both lean your way." : adjustedPct <= -8 ? "You're giving up more value or roster fit than you get back." : "Fair deal — the value and roster fit are close.";
  return <main className="mx-auto w-full max-w-5xl px-3 pb-16 pt-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Front Office</p><h1 className="display-title text-4xl">Trade <span className="text-primary">Evaluator</span></h1><p className="mt-1 text-sm text-muted-foreground">ADP + projections + player value + your roster needs.</p></div><div className="rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">Scoring: <b className="text-foreground">{draft.settings.scoring}</b> · Team: <b className="text-foreground">{draft.settings.myTeam}</b></div></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2"><PlayerPicker label="You give" players={data.players} selected={give} onAdd={(p) => setGive((s) => [...s, p])} onRemove={(id) => setGive((s) => s.filter((p) => p.id !== id))}/><PlayerPicker label="You receive" accent="get" players={data.players} selected={get} onAdd={(p) => setGet((s) => [...s, p])} onRemove={(id) => setGet((s) => s.filter((p) => p.id !== id))}/></div>
    <section className="mt-4 rounded-xl border border-border bg-card p-4"><div className="flex items-center gap-4"><div className={cn("flex h-16 w-16 items-center justify-center rounded-lg border font-display text-3xl font-bold", !ready ? "border-border text-muted-foreground" : adjustedGrade.tone === "good" ? "border-primary bg-primary/10 text-primary" : adjustedGrade.tone === "bad" ? "border-destructive bg-destructive/10 text-destructive" : "border-border bg-surface text-foreground")}>{ready ? adjustedGrade.letter : "—"}</div><div className="flex-1"><p className="font-medium">{verdict}</p>{ready && <p className="tabnum mt-1 text-xs text-muted-foreground">Raw value: {base.diffPct.toFixed(1)}% · Roster-fit adjustment: {needDelta > 0 ? "+" : ""}{needDelta}% · Final: {adjustedPct.toFixed(1)}%</p>}</div></div>{ready && <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded bg-surface p-2"><b className="block text-sm">{base.give}</b>Give value</div><div className="rounded bg-surface p-2"><b className="block text-sm">{base.get}</b>Get value</div><div className="rounded bg-surface p-2"><b className="block text-sm">{needDelta > 0 ? "+" : ""}{needDelta}%</b>Team need</div></div>}</section>
    <p className="mt-3 text-center text-[11px] text-muted-foreground">The team-need modifier rewards positions where your configured roster still has open slots. Configure teams, scoring and roster slots in the War Room settings.</p>
  </main>;
}
