import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { startTransition, useMemo, useRef, useState } from "react";

import { playerImage, teamLogo } from "@/components/draft/PlayerAvatar";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
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
import type { Pos } from "@/lib/draft";
import { getTeamPrimaryColor } from "@/lib/nfl-teams";
import { getInjuryReports } from "@/lib/players.functions";
import type { InjuryReportItem } from "@/lib/players.server";
import { cn } from "@/lib/utils";

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

const STATUS_CHIP: Record<string, string> = {
  IR: "bg-rose-50 text-rose-600",
  OUT: "bg-rose-50 text-rose-600",
  SUSP: "bg-rose-50 text-rose-600",
  PUP: "bg-orange-50 text-orange-600",
  D: "bg-orange-50 text-orange-600",
  Q: "bg-amber-50 text-amber-700",
  NA: "bg-rose-50 text-rose-600",
  DNR: "bg-rose-50 text-rose-600",
  COV: "bg-rose-50 text-rose-600",
};

const BANNER_CHIP_TEXT: Record<string, string> = {
  IR: "text-rose-600",
  OUT: "text-rose-600",
  SUSP: "text-rose-600",
  PUP: "text-orange-600",
  D: "text-orange-600",
  Q: "text-amber-700",
  NA: "text-rose-600",
  DNR: "text-rose-600",
  COV: "text-rose-600",
};

const STATUS_LABEL: Record<string, string> = {
  IR: "Injured Reserve",
  OUT: "Out",
  SUSP: "Suspended",
  PUP: "PUP List",
  D: "Doubtful",
  Q: "Questionable",
  NA: "Not Active",
  DNR: "Did Not Report",
  COV: "COVID-19",
};

type Owner = { team: string; isMine: boolean };

function formatPublished(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}

function formatReturn(iso: string | null): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at) || at < Date.now() - 24 * 60 * 60 * 1000) return null;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

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
    refetchInterval: 10 * 60 * 1000,
    retry: 1,
    queryFn: () => getInjuryReports(),
  });

  const { data: playersPayload } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const { teams } = useLeagueRosters(players);

  const ownerById = useMemo(() => {
    const map = new Map<string, Owner>();
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
            <InjuryReportRow
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

function ReportHeadshot({ item }: { item: InjuryReportItem }) {
  const sources = useMemo(() => {
    const list: string[] = [];
    if (item.sleeperId) list.push(playerImage(item.sleeperId, item.pos as Pos, item.team ?? ""));
    if (item.headshot) list.push(item.headshot);
    return list;
  }, [item.sleeperId, item.pos, item.team, item.headshot]);
  const [attempt, setAttempt] = useState(0);
  const src = sources[attempt];
  const frame = "relative z-20 size-16 flex-shrink-0 rounded-full border-2 border-white/40 shadow-sm";

  if (!src) return <span className={cn(frame, "bg-white/20")} />;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setAttempt((n) => n + 1)}
      className={cn(frame, "bg-white/10 object-cover")}
    />
  );
}

function InjuryReportRow({
  item,
  owner,
  showOwnership,
  onOpen,
}: {
  item: InjuryReportItem;
  owner: Owner | null;
  showOwnership: boolean;
  onOpen: (id: string) => void;
}) {
  const returnLabel = formatReturn(item.returnDate);
  const headlineClass = "text-left text-base font-bold leading-snug text-blue-700 hover:underline";
  const logo = teamLogo(item.team);
  const bannerLink = "text-white/90 hover:text-white hover:underline";

  return (
    <li className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div
        className="relative flex items-center overflow-hidden px-5 py-4"
        style={{ backgroundColor: getTeamPrimaryColor(item.team) }}
      >
        <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-r from-black/25 via-transparent to-transparent" />
        {logo ? (
          <img
            src={logo}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-1/2 z-0 h-24 w-24 -translate-y-1/2 select-none object-contain opacity-[0.14]"
          />
        ) : null}
        <div className="relative z-20 flex min-w-0 items-center gap-4">
          {item.sleeperId ? (
            <button
              type="button"
              onClick={() => onOpen(item.sleeperId!)}
              className="flex-shrink-0"
              aria-label={`Open ${item.playerName} details`}
            >
              <ReportHeadshot item={item} />
            </button>
          ) : (
            <ReportHeadshot item={item} />
          )}
          <div className="min-w-0">
            {item.sleeperId ? (
              <button
                type="button"
                onClick={() => onOpen(item.sleeperId!)}
                className="block truncate text-left text-base font-black tracking-wide text-white hover:opacity-90"
              >
                {item.playerName}
              </button>
            ) : (
              <p className="truncate text-base font-black tracking-wide text-white">{item.playerName}</p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-white/85">
                {item.pos} · {item.team ?? "FA"}
              </span>
              <span
                className={cn(
                  "rounded bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  item.statusShort
                    ? (BANNER_CHIP_TEXT[item.statusShort] ?? "text-slate-600")
                    : "text-emerald-700",
                )}
              >
                {item.statusShort ? (STATUS_LABEL[item.statusShort] ?? item.status) : "Active"}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] font-medium">
              {item.sleeperId ? (
                <button type="button" onClick={() => onOpen(item.sleeperId!)} className={bannerLink}>
                  Player Card
                </button>
              ) : null}
              {item.sleeperId && item.team ? <span className="text-white/50">·</span> : null}
              {item.team ? (
                <Link to="/nfl-team/$nflId" params={{ nflId: item.team }} className={bannerLink}>
                  Team Page
                </Link>
              ) : null}
              {item.link && (item.sleeperId || item.team) ? <span className="text-white/50">·</span> : null}
              {item.link ? (
                <a href={item.link} target="_blank" rel="noreferrer" className={bannerLink}>
                  More News
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="px-5 py-5">
        {item.sleeperId ? (
          <button type="button" onClick={() => onOpen(item.sleeperId!)} className={headlineClass}>
            {item.headline}
          </button>
        ) : (
          <h2 className={headlineClass}>{item.headline}</h2>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {item.published ? (
            <>
              <span>{formatPublished(item.published)}</span>
              <span className="text-slate-300">·</span>
            </>
          ) : null}
          <span>{item.source}</span>
          {item.sourceStatusShort ? (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                STATUS_CHIP[item.sourceStatusShort] ?? "bg-slate-100 text-slate-600",
              )}
            >
              {STATUS_LABEL[item.sourceStatusShort] ?? item.sourceStatus}
            </span>
          ) : item.sourceStatusShort === "" ? (
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
              Active
            </span>
          ) : null}
          {returnLabel ? <span className="font-medium text-slate-600">Est. return {returnLabel}</span> : null}
          {showOwnership ? (
            owner ? (
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  owner.isMine ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-600",
                )}
              >
                {owner.isMine ? "On Your Team" : `Rostered by ${owner.team}`}
              </span>
            ) : (
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                Available
              </span>
            )
          ) : null}
        </div>

        <p className="mt-3 text-sm leading-relaxed text-slate-700">{item.news}</p>
        {item.analysis ? (
          <p className="mt-2 text-sm leading-relaxed text-slate-700">
            <span className="font-bold italic text-slate-900">Fantasy Impact:</span> {item.analysis}
          </p>
        ) : null}
      </div>
    </li>
  );
}
