import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, ChevronDown, Minus, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { PlayerAvatar, teamLogo } from "@/components/draft/PlayerAvatar";
import { playerPressProps, useOpenMobilePlayer } from "@/components/mobile/MobilePlayerSheet";
import {
  useLeagueProjections,
  useSeasonProjectionStats,
  useSleeperWeekStats,
  type WeeklyProjRow,
} from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useNflGameProgress } from "@/hooks/useNflGameProgress";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Player } from "@/lib/players-build";
import { projectionPoints } from "@/lib/scoring-map";
import { cn } from "@/lib/utils";

import {
  HEX_CLIP,
  REGULAR_SEASON_WEEKS,
  gameStripLabels, progressFor, scheduleOpponent, shortName, useNflSchedule } from "./lineupShared";

type PosFilter = "ALL" | "QB" | "RB" | "WR" | "TE" | "FLEX" | "K" | "DEF";
type Mode = "projections" | "stats" | "trends";
type Ownership = "all" | "available" | "rostered";
type Action = "add" | "drop" | "trade";

const POS_CHIPS: { id: PosFilter; label: string }[] = [
  { id: "QB", label: "QB" },
  { id: "RB", label: "RB" },
  { id: "WR", label: "WR" },
  { id: "TE", label: "TE" },
  { id: "FLEX", label: "R/W/T" },
  { id: "K", label: "K" },
  { id: "DEF", label: "DEF" },
];
const FLEX_POS = new Set(["RB", "WR", "TE"]);
const PAGE_SIZE = 50;

const matchesPos = (p: Player, pos: PosFilter) =>
  pos === "ALL" || (pos === "FLEX" ? FLEX_POS.has(p.pos) : p.pos === pos);

type TrendRow = { player_id: string; count: number };

function useSleeperTrending(type: "add" | "drop") {
  return useQuery({
    queryKey: ["sleeper-trending", type, "24h-100"],
    staleTime: 15 * 60 * 1000,
    retry: false,
    queryFn: async (): Promise<TrendRow[]> => {
      const res = await fetch(
        `https://api.sleeper.app/v1/players/nfl/trending/${type}?lookback_hours=24&limit=100`,
      ).catch(() => null);
      const rows = res && res.ok ? ((await res.json()) as unknown) : null;
      return Array.isArray(rows) ? (rows as TrendRow[]) : [];
    },
  });
}

type Column = { key: string; label: string; value: (p: Player) => number | null; decimals: number };

export function MobilePlayersView() {
  const { data: playersPayload, loading: playersLoading } = useSleeperPlayers();
  const players = useMemo(() => playersPayload?.players ?? [], [playersPayload]);
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const { teams, myTeam, rosteredIds } = useLeagueRosters(players);

  const [trendPos, setTrendPos] = useState<PosFilter>("QB");
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<Mode>("stats");
  const [pos, setPos] = useState<PosFilter>("ALL");
  const [ownership, setOwnership] = useState<Ownership>("all");
  const [period, setPeriod] = useState<"season" | number>("season");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const projectionWeek = mode === "projections" && period !== "season" ? period : null;
  const { nflWeek, nflSeason, projectFor, rankFor, seasonStats, scoringMap, format } =
    useLeagueProjections(projectionWeek);
  const seasonProjections = useSeasonProjectionStats();
  const currentWeek = nflWeek ?? 1;
  const { progressByNflTeam } = useNflGameProgress(currentWeek);
  const { data: schedule = [] } = useNflSchedule();
  const { data: trendingAdds = [], isLoading: trendingLoading } = useSleeperTrending("add");
  const { data: trendingDrops = [] } = useSleeperTrending("drop");

  const weekStats = useSleeperWeekStats(nflSeason, mode === "stats" && period !== "season" ? period : null);

  const myIds = useMemo(() => new Set((myTeam?.players ?? []).map((p) => p.id)), [myTeam]);
  const ownerById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teams) for (const p of t.players) map.set(p.id, t.team);
    return map;
  }, [teams]);
  const actionFor = (p: Player): Action => (myIds.has(p.id) ? "drop" : rosteredIds.has(p.id) ? "trade" : "add");

  const addsById = useMemo(() => new Map(trendingAdds.map((r) => [r.player_id, r.count])), [trendingAdds]);
  const dropsById = useMemo(() => new Map(trendingDrops.map((r) => [r.player_id, r.count])), [trendingDrops]);

  const scored = (rows: Map<string, WeeklyProjRow> | undefined, id: string) =>
    projectionPoints(rows?.get(id)?.stats, scoringMap, format);

  const columns: { group: string; cols: Column[] } = useMemo(() => {
    if (mode === "trends") {
      return {
        group: "Last 24 Hours",
        cols: [
          { key: "adds", label: "Adds", value: (p) => addsById.get(p.id) ?? null, decimals: 0 },
          { key: "drops", label: "Drops", value: (p) => dropsById.get(p.id) ?? null, decimals: 0 },
        ],
      };
    }
    if (mode === "projections") {
      const value =
        period === "season"
          ? (p: Player) => seasonProjections.projectFor(p.id)
          : (p: Player) => projectFor(p.id);
      return {
        group: "Projected",
        cols: [{ key: "proj", label: period === "season" ? "Season" : `Week ${period}`, value, decimals: 2 }],
      };
    }
    if (period !== "season") {
      return {
        group: "Points",
        cols: [{ key: "week", label: `Week ${period}`, value: (p) => scored(weekStats.data, p.id), decimals: 2 }],
      };
    }
    return {
      group: "Points",
      cols: [
        { key: "season", label: "Season", value: (p) => scored(seasonStats, p.id), decimals: 2 },
        {
          key: "avg",
          label: "Avg",
          value: (p) => {
            const pts = scored(seasonStats, p.id);
            const gp = Number(seasonStats?.get(p.id)?.stats["gp"] ?? 0);
            return pts != null && gp > 0 ? pts / gp : null;
          },
          decimals: 2,
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, period, addsById, dropsById, seasonStats, weekStats.data, scoringMap, format, projectFor, seasonProjections.projectFor]);

  const activeKey = columns.cols.some((c) => c.key === sortKey) ? sortKey! : columns.cols[0]!.key;
  const primary = columns.cols[0]!;

  const posRanks = useMemo(() => {
    const byPos = new Map<string, { id: string; v: number }[]>();
    for (const p of players) {
      const v = primary.value(p);
      if (v == null || v <= 0) continue;
      const list = byPos.get(p.pos) ?? [];
      list.push({ id: p.id, v });
      byPos.set(p.pos, list);
    }
    const ranks = new Map<string, number>();
    for (const list of byPos.values()) {
      list.sort((a, b) => b.v - a.v).forEach((e, i) => ranks.set(e.id, i + 1));
    }
    return ranks;
  }, [players, primary]);

  const tableCols: Column[] = [
    ...columns.cols,
    { key: "pos", label: "Pos Rank", value: (p) => posRanks.get(p.id) ?? null, decimals: 0 },
  ];
  const sortCol = tableCols.find((c) => c.key === activeKey) ?? primary;

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = players
      .filter((p) => matchesPos(p, pos))
      .filter((p) =>
        ownership === "available" ? !rosteredIds.has(p.id) : ownership === "rostered" ? rosteredIds.has(p.id) : true,
      )
      .filter((p) => !needle || p.name.toLowerCase().includes(needle))
      .map((p) => ({ p, v: sortCol.value(p) }));
    const asc = sortCol.key === "pos";
    list.sort((a, b) => {
      if (a.v == null) return b.v == null ? 0 : 1;
      if (b.v == null) return -1;
      return asc ? a.v - b.v : b.v - a.v;
    });
    return list.map((r) => r.p);
  }, [players, pos, ownership, rosteredIds, search, sortCol]);

  const mostAdded = useMemo(
    () =>
      trendingAdds
        .map((r) => ({ player: playersById.get(r.player_id), count: r.count }))
        .filter((r): r is { player: Player; count: number } => Boolean(r.player) && matchesPos(r.player!, trendPos))
        .slice(0, 10),
    [trendingAdds, playersById, trendPos],
  );

  const weeks =
    mode === "projections"
      ? Array.from({ length: Math.max(0, REGULAR_SEASON_WEEKS - currentWeek + 1) }, (_, i) => currentWeek + i)
      : Array.from({ length: currentWeek }, (_, i) => currentWeek - i);
  const periodOptions = [
    { value: "season", label: `${nflSeason ?? ""} Season`.trim() },
    ...weeks.map((w) => ({ value: String(w), label: `Week ${w}` })),
  ];

  const helpers = {
    badge: (p: Player) => rankFor(p.id).pos,
    game: (p: Player) =>
      gameStripLabels(progressFor(p.team, progressByNflTeam), {
        bye: p.bye === currentWeek,
        opponent: scheduleOpponent(schedule, currentWeek, p.team),
      }),
  };

  return (
    <main className="pb-6">
      <h2 className="px-4 pb-3 pt-5 font-display text-lg font-bold uppercase tracking-[0.08em] text-m-section">
        Most Added Players
      </h2>
      <ChipRow
        options={POS_CHIPS}
        value={trendPos}
        onChange={(v) => setTrendPos(v)}
        className="px-2.5"
      />
      <div className="mt-3 flex snap-x gap-2.5 overflow-x-auto px-2.5 pb-1 [scrollbar-width:none]">
        {trendingLoading || playersLoading ? (
          <p className="py-8 text-sm text-m-muted">Loading trending players...</p>
        ) : mostAdded.length ? (
          mostAdded.map((r, i) => (
            <TrendingCard
              key={r.player.id}
              index={i + 1}
              player={r.player}
              count={r.count}
              badge={helpers.badge(r.player)}
              owner={ownerById.get(r.player.id) ?? null}
            />
          ))
        ) : (
          <p className="py-8 text-sm text-m-muted">No trending adds at this position.</p>
        )}
      </div>

      <section className="mx-2.5 mt-5 space-y-3 rounded-xl bg-m-card p-3 text-m-card-fg">
        <label className="flex items-center gap-2 rounded-lg border border-m-border px-4 py-3">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(PAGE_SIZE);
            }}
            placeholder="Search by name"
            className="min-w-0 flex-1 bg-transparent text-base text-m-card-fg outline-none placeholder:text-m-muted"
          />
          <Search className="size-5 text-m-muted" />
        </label>

        <ChipRow
          options={[
            { id: "projections", label: "Projections" },
            { id: "stats", label: "Stats" },
            { id: "trends", label: "Trends" },
          ]}
          value={mode}
          onChange={(v) => {
            setMode(v);
            setSortKey(null);
            setPeriod("season");
          }}
        />
        <ChipRow
          options={[{ id: "ALL", label: "All" }, ...POS_CHIPS]}
          value={pos}
          onChange={(v) => {
            setPos(v);
            setLimit(PAGE_SIZE);
          }}
        />

        <div className="grid grid-cols-2 gap-2.5">
          <SelectBox
            label="Filter players by ownership"
            value={ownership}
            options={[
              { value: "all", label: "All Players" },
              { value: "available", label: "Available" },
              { value: "rostered", label: "Rostered" },
            ]}
            onChange={(v) => {
              setOwnership(v as Ownership);
              setLimit(PAGE_SIZE);
            }}
          />
          <SelectBox
            label="Select time period"
            value={String(period)}
            options={mode === "trends" ? periodOptions.slice(0, 1) : periodOptions}
            disabled={mode === "trends"}
            onChange={(v) => setPeriod(v === "season" ? "season" : Number(v))}
          />
        </div>
      </section>

      <h2 className="px-4 pb-3 pt-6 font-display text-lg font-bold uppercase tracking-[0.08em] text-m-section">
        Filter Results
      </h2>
      <div className="overflow-x-auto bg-m-card text-m-card-fg [scrollbar-width:none]">
        <div className="min-w-max">
          <div className="flex border-b border-m-border text-[11px] font-semibold uppercase tracking-wide text-m-muted">
            <div className="sticky left-0 z-10 w-[230px] shrink-0 bg-m-card" />
            <div className="flex flex-col">
              <span className="px-3 pt-3 pb-1.5 text-center">{columns.group}</span>
              <div className="flex">
                {tableCols.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setSortKey(c.key)}
                    className={cn(
                      "flex w-[88px] items-center justify-end gap-1 px-3 py-2.5 uppercase",
                      c.key === sortCol.key && "bg-m-rank-col text-m-card-fg",
                    )}
                  >
                    {c.key === sortCol.key ? <ChevronDown className="size-3" /> : null}
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {playersLoading ? (
            <p className="px-5 py-10 text-center text-sm text-m-muted">Loading players...</p>
          ) : rows.length ? (
            rows.slice(0, limit).map((p) => (
              <PlayerRow
                key={p.id}
                player={p}
                action={actionFor(p)}
                badge={helpers.badge(p)}
                game={helpers.game(p).game}
                cols={tableCols}
                sortKey={sortCol.key}
              />
            ))
          ) : (
            <p className="px-5 py-10 text-center text-sm text-m-muted">No players match these filters.</p>
          )}
        </div>
      </div>
      {rows.length > limit ? (
        <button
          type="button"
          onClick={() => setLimit((n) => n + PAGE_SIZE)}
          className="mx-2.5 mt-3 w-[calc(100%-1.25rem)] rounded-lg bg-m-select-bg py-3 font-display text-base font-semibold text-m-select-fg"
        >
          Show More
        </button>
      ) : null}
    </main>
  );
}

function ChipRow<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-2 overflow-x-auto [scrollbar-width:none]", className)}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "shrink-0 rounded-md border px-3.5 py-2.5 font-display text-base font-semibold uppercase tracking-wide",
            value === o.id
              ? "border-m-tab-active-border bg-m-tab-active text-m-tab-active-fg"
              : "border-transparent bg-m-select-bg text-m-select-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SelectBox({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <label
      className={cn(
        "relative flex items-center justify-between rounded-lg bg-m-select-bg px-4 py-3 font-display text-base font-semibold text-m-select-fg",
        disabled && "opacity-60",
      )}
    >
      <span className="truncate">{current?.label}</span>
      <ChevronDown className="size-5 shrink-0" />
      <select
        aria-label={label}
        value={current?.value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function RankHex({ rank, className }: { rank: number | null; className?: string }) {
  if (!rank) return null;
  return (
    <span
      className={cn(
        "absolute flex items-center justify-center bg-m-pos-rank-bg font-display font-bold text-m-pos-rank-fg",
        className,
      )}
      style={{ clipPath: HEX_CLIP }}
    >
      {rank}
    </span>
  );
}

function TrendingCard({
  index,
  player,
  count,
  badge,
  owner,
}: {
  index: number;
  player: Player;
  count: number;
  badge: number | null;
  owner: string | null;
}) {
  const logo = teamLogo(player.team);
  const openPlayer = useOpenMobilePlayer();
  return (
    <article
      className="w-[140px] shrink-0 cursor-pointer snap-start overflow-hidden rounded-xl bg-m-card text-m-card-fg"
      {...playerPressProps(openPlayer, player.id)}
    >
      <div className="relative px-2.5 pb-2.5 pt-2.5">
        <span className="absolute left-2.5 top-2 font-display text-sm font-bold text-m-muted">{index}</span>
        <div className="relative mx-auto w-fit">
          <PlayerAvatar
            id={player.id}
            pos={player.pos}
            team={player.team}
            name={player.name}
            className="size-14"
            logoClassName="hidden"
          />
          <RankHex rank={badge} className="-left-3 -top-1 size-7 text-xs" />
        </div>
        <p className="mt-2 flex items-center justify-center gap-1 truncate font-display text-lg font-bold leading-tight">
          <span className="truncate">{shortName(player)}</span>
          {logo ? <img src={logo} alt="" className="size-4 shrink-0 object-contain" /> : null}
        </p>
        <p className="mt-0.5 flex items-center justify-center gap-1 truncate text-xs text-m-muted">
          {owner ? (
            <span className="truncate">{owner}</span>
          ) : (
            <>
              <span className="flex size-3.5 items-center justify-center rounded-sm bg-[#1fae5b] text-white">
                <Plus className="size-3" strokeWidth={3} />
              </span>
              Free Agent
            </>
          )}
        </p>
      </div>
      <div className="bg-m-row-alt py-2 text-center text-sm font-semibold tabnum">{count.toLocaleString()}</div>
    </article>
  );
}

const ACTION_STYLE: Record<Action, { className: string; label: string; to: "/trade" | "/waiver" }> = {
  trade: { className: "bg-[#f08a24] shadow-[inset_0_-3px_0_#c96a12]", label: "Trade for player", to: "/trade" },
  drop: { className: "bg-[#e8551f] shadow-[inset_0_-3px_0_#b83d10]", label: "Drop player", to: "/waiver" },
  add: { className: "bg-[#1fae5b] shadow-[inset_0_-3px_0_#168444]", label: "Add player", to: "/waiver" },
};

function PlayerRow({
  player,
  action,
  badge,
  game,
  cols,
  sortKey,
}: {
  player: Player;
  action: Action;
  badge: number | null;
  game: string;
  cols: Column[];
  sortKey: string;
}) {
  const style = ACTION_STYLE[action];
  const Icon = action === "trade" ? ArrowLeftRight : action === "drop" ? Minus : Plus;
  const openPlayer = useOpenMobilePlayer();
  return (
    <div className="flex border-b border-m-border">
      <div className="sticky left-0 z-10 flex w-[230px] shrink-0 items-center gap-2.5 bg-m-card px-2.5 py-2.5">
        <Link
          to={style.to}
          aria-label={style.label}
          className={cn("flex size-11 shrink-0 items-center justify-center rounded-lg text-white", style.className)}
        >
          <Icon className="size-5" strokeWidth={2.5} />
        </Link>
        <div
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5"
          {...playerPressProps(openPlayer, player.id)}
        >
          <div className="relative shrink-0">
            <PlayerAvatar
              id={player.id}
              pos={player.pos}
              team={player.team}
              name={player.name}
              className="size-11"
              logoClassName="hidden"
            />
            <RankHex rank={badge} className="-left-1.5 -top-1.5 size-6 text-[11px]" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold leading-tight">
              {shortName(player)}
              {player.injury_status ? (
                <span className="ml-1 align-middle text-[10px] font-bold uppercase text-red-500">
                  {player.injury_status.slice(0, 1)}
                </span>
              ) : null}
            </p>
            <p className="truncate text-xs text-m-muted">
              {player.team || "FA"} - {player.pos}
            </p>
            {game ? <p className="truncate text-[10px] font-semibold uppercase text-m-muted">{game}</p> : null}
          </div>
        </div>
      </div>
      {cols.map((c) => {
        const v = c.value(player);
        return (
          <div
            key={c.key}
            className={cn(
              "flex w-[88px] items-center justify-end px-3 text-[15px] tabnum",
              c.key === sortKey && "bg-m-rank-col",
            )}
          >
            {v == null ? "-" : v.toFixed(c.decimals)}
          </div>
        );
      })}
    </div>
  );
}
