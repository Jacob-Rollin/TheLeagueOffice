import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { startTransition, useMemo, useRef, useState } from "react";

import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import { InjuryReportCard, type InjuryReportOwner } from "@/components/injury/InjuryReportCard";
import { ActiveLeagueLabel } from "@/components/league/ActiveLeagueLabel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { fetchSnapInjuryReports } from "@/lib/snap-cdn";

export const Route = createFileRoute("/injury-reports")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Injury Reports — The League Office" },
      {
        name: "description",
        content: "The latest NFL injury news and fantasy impact, filtered to your team or your league.",
      },
    ],
  }),
  component: InjuryReportsPage,
});

type Scope = "nfl" | "league" | "mine";
type PosFilter = "all" | "QB" | "RB" | "WR" | "TE" | "K";

const PAGE_SIZE = 20;

const POS_OPTIONS: { value: PosFilter; label: string }[] = [
  { value: "all", label: "All Positions" },
  { value: "QB", label: "QB" },
  { value: "RB", label: "RB" },
  { value: "WR", label: "WR" },
  { value: "TE", label: "TE" },
  { value: "K", label: "K" },
];

function InjuryReportsPage() {
  const [scope, setScope] = useState<Scope>("nfl");
  const [pos, setPos] = useState<PosFilter>("all");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const modalRef = useRef<PlayerModalHandle>(null);
  const openPlayer = (id: string) => modalRef.current?.open(id);

  const { activeLeague } = useActiveLeague();
  const hasLeague = Boolean(activeLeague?.id);

  const query = useQuery({
    queryKey: ["injury-reports"],
    staleTime: 5 * 60 * 1000,
    refetchInterval: (q) =>
      typeof document !== "undefined" && document.visibilityState !== "visible"
        ? false
        : 10 * 60 * 1000,
    refetchIntervalInBackground: false,
    retry: false,
    queryFn: () => fetchSnapInjuryReports(),
  });

  const { data: playersPayload } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const { teams } = useLeagueRosters(players);

  const ownerById = useMemo(() => {
    const map = new Map<string, InjuryReportOwner>();
    for (const t of teams) {
      for (const p of t.players) map.set(p.id, { team: t.team, isMine: t.isMine });
    }
    return map;
  }, [teams]);

  const effectiveScope: Scope = hasLeague ? scope : "nfl";
  const rows = useMemo(() => {
    return (query.data?.items ?? []).filter((item) => {
      if (pos !== "all" && item.pos !== pos) return false;
      if (effectiveScope === "nfl") return true;
      const owner = item.sleeperId ? ownerById.get(item.sleeperId) : undefined;
      return effectiveScope === "mine" ? Boolean(owner?.isMine) : Boolean(owner);
    });
  }, [query.data?.items, pos, effectiveScope, ownerById]);

  const shown = rows.slice(0, visible);
  const updatedLabel = query.data?.updatedAt
    ? new Date(query.data.updatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : null;

  const changeFilter = (apply: () => void) =>
    startTransition(() => {
      apply();
      setVisible(PAGE_SIZE);
    });

  const emptyMessage =
    effectiveScope === "mine"
      ? "No injury news for players on your team right now."
      : effectiveScope === "league"
        ? "No injury news for players rostered in your league right now."
        : "No injury news right now.";

  return (
    <main className="mx-auto w-full max-w-shell px-3 pb-16 pt-6">
      <div className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="display-title text-3xl text-slate-900">
            Injury <span className="text-primary">Reports</span>
          </h1>
          <ActiveLeagueLabel />
        </div>
        <p className="mt-1 text-sm text-slate-500">Latest NFL injury news, newest first.</p>
        {updatedLabel ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            Updated {updatedLabel}
          </p>
        ) : null}
      </div>

      <div className="mb-4 rounded-xl border border-sky-100 bg-sky-50/80 px-4 py-3 text-sm text-slate-600">
        <p className="font-semibold text-slate-800">Where this comes from</p>
        <p className="mt-1 leading-relaxed">
          Designations come from Sleeper, the same source as our projections, lineups and player
          cards. News and fantasy analysis come from ESPN's NFL injury report and RotoWire. Both
          refresh every 10 minutes, covering every current designation plus recent recovery updates.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={effectiveScope} onValueChange={(v) => changeFilter(() => setScope(v as Scope))}>
          <SelectTrigger
            aria-label="Players"
            className="h-9 w-[12rem] shrink-0 border-slate-200 bg-white shadow-none"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="nfl">All NFL</SelectItem>
            <SelectItem value="league" disabled={!hasLeague}>
              League Rostered
            </SelectItem>
            <SelectItem value="mine" disabled={!hasLeague}>
              My Team
            </SelectItem>
          </SelectContent>
        </Select>

        <Select value={pos} onValueChange={(v) => changeFilter(() => setPos(v as PosFilter))}>
          <SelectTrigger
            aria-label="Position"
            className="h-9 w-[10rem] shrink-0 border-slate-200 bg-white shadow-none"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {POS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {query.isLoading || query.isError || shown.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {query.isLoading ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">Loading injury reports…</p>
          ) : query.isError ? (
            <p className="px-5 py-10 text-center text-sm text-rose-600">
              Could not load injury reports. Try again shortly.
            </p>
          ) : (
            <p className="px-5 py-10 text-center text-sm text-slate-400">{emptyMessage}</p>
          )}
        </div>
      ) : (
        <ul className="space-y-4">
          {shown.map((item) => (
            <InjuryReportCard
              key={item.id}
              item={item}
              owner={item.sleeperId ? (ownerById.get(item.sleeperId) ?? null) : null}
              showOwnership={hasLeague}
              onOpen={openPlayer}
            />
          ))}
        </ul>
      )}

      {rows.length > 0 ? (
        <div className="mt-4 flex flex-col items-center gap-1.5">
          {visible < rows.length ? (
            <button
              type="button"
              onClick={() => setVisible((n) => n + PAGE_SIZE)}
              className="text-sm font-semibold text-primary hover:underline"
            >
              Load More
            </button>
          ) : null}
          <p className="text-xs text-slate-400">
            Showing {shown.length} of {rows.length}
          </p>
        </div>
      ) : null}

      <PlayerModalHost ref={modalRef} />
    </main>
  );
}
