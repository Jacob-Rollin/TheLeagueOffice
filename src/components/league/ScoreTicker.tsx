import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

type TickerTeam = {
  abbr: string;
  logo: string;
  score: string;
  possession: boolean;
  record: string;
};
type TickerGame = {
  id: string;
  state: "pre" | "in" | "post";
  detail: string;
  kickoff: string;
  clock: string;
  period: string;
  downDistance: string;
  ballOn: string;
  network: string;
  away: TickerTeam;
  home: TickerTeam;
  link: string;
};

type WeekOption = {
  seasonType: number;
  week: number;
  label: string;
};

/**
 * Scheduled kickoff in the viewer's local timezone.
 * Within the next 6 days: "SUN 12:00 PM".
 * Further out (future weeks): "SUN 9/14 12:00 PM".
 */
function formatKickoff(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfGameDay = new Date(d);
  startOfGameDay.setHours(0, 0, 0, 0);
  const daysAway = Math.round((startOfGameDay.getTime() - startOfToday.getTime()) / 86_400_000);
  if (daysAway < 0 || daysAway > 6) {
    const date = d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
    return `${day} ${date} ${time}`;
  }
  return `${day} ${time}`;
}

function truncateNetwork(name: string, maxChars = 14): string {
  const clean = name.trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars)}...`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapGames(json: any): TickerGame[] {
  const events: any[] = json?.events ?? [];
  return events.map((ev) => {
    const comp = ev?.competitions?.[0] ?? {};
    const status = comp?.status ?? ev?.status ?? {};
    const type = status?.type ?? {};
    const possessionId: string | undefined = comp?.situation?.possession;
    const teams: any[] = comp?.competitors ?? [];
    const pick = (side: string): TickerTeam => {
      const c = teams.find((t) => t?.homeAway === side) ?? {};
      return {
        abbr: c?.team?.abbreviation ?? c?.team?.shortDisplayName ?? "—",
        logo: c?.team?.logo ?? "",
        score: c?.score ?? "0",
        possession: Boolean(possessionId) && String(c?.id) === String(possessionId),
        record: String(c?.records?.find((r: any) => r?.type === "total")?.summary ?? c?.records?.[0]?.summary ?? ""),
      };
    };
    const state: TickerGame["state"] = type?.state === "in" ? "in" : type?.state === "post" ? "post" : "pre";
    const sit = comp?.situation ?? {};
    const network =
      comp?.broadcasts?.[0]?.names?.[0] ?? comp?.geoBroadcasts?.[0]?.media?.shortName ?? comp?.broadcast ?? "";
    return {
      id: String(ev?.id ?? Math.random()),
      state,
      detail: type?.shortDetail ?? "",
      kickoff: formatKickoff(ev?.date ?? comp?.date),
      clock: status?.displayClock ?? "",
      period: status?.period ? `Q${status.period}` : "",
      downDistance: String(sit?.shortDownDistanceText ?? String(sit?.downDistanceText ?? "").split(" at ")[0] ?? ""),
      ballOn: String(sit?.possessionText ?? "").replace(/^at\s+/i, ""),
      network: String(network || ""),
      away: pick("away"),
      home: pick("home"),
      link: ev?.links?.[0]?.href ?? "https://www.espn.com/nfl/scoreboard",
    };
  });
}

function readCurrentWeek(json: any): number {
  return Number(json?.week?.number ?? 1);
}

function readCurrentSeasonType(json: any): number {
  return Number(json?.season?.type ?? json?.leagues?.[0]?.season?.type ?? 2);
}

/** Compact label, e.g. "WK 3", "PRE 2", "WC". */
function shortLabel(seasonType: number, week: number, raw: string): string {
  const text = String(raw || "");
  if (seasonType === 3) {
    const t = text.toLowerCase();
    if (t.includes("wild")) return "WC";
    if (t.includes("division")) return "DIV";
    if (t.includes("conference")) return "CONF";
    if (t.includes("super")) return "SB";
    if (t.includes("pro bowl")) return "PB";
    return text.toUpperCase().slice(0, 6);
  }
  if (seasonType === 1) return `PRE ${week}`;
  if (seasonType === 4) return "PRO";
  return `WK ${week}`;
}

function buildWeekOptions(json: any): WeekOption[] {
  const calendar: any[] = Array.isArray(json?.leagues?.[0]?.calendar) ? json.leagues[0].calendar : [];
  const options: WeekOption[] = [];
  for (const block of calendar) {
    const seasonType = Number(block?.value);
    if (!Number.isFinite(seasonType)) continue;
    const entries = Array.isArray(block?.entries) ? block.entries : [];
    for (const entry of entries) {
      const week = Number(entry?.value);
      if (!Number.isFinite(week)) continue;
      options.push({
        seasonType,
        week,
        label: entry?.label ?? shortLabel(seasonType, week, `Week ${week}`),
      });
    }
  }
  return options;
}

function filterWeekOptions(options: WeekOption[], currentSeasonType: number, currentWeek: number): WeekOption[] {
  const filtered: WeekOption[] = [];
  for (const opt of options) {
    if (opt.seasonType !== currentSeasonType) continue;
    if (opt.week <= currentWeek || opt.week === currentWeek + 1) {
      filtered.push(opt);
    }
  }

  // Preseason transition: if at the final preseason week, offer Regular Season Week 1.
  if (currentSeasonType === 1) {
    const preseasonWeeks = options.filter((o) => o.seasonType === 1).map((o) => o.week);
    const maxPreseason = preseasonWeeks.length ? Math.max(...preseasonWeeks) : 0;
    if (currentWeek === maxPreseason) {
      const rsWeek1 = options.find((o) => o.seasonType === 2 && o.week === 1);
      if (rsWeek1) filtered.push(rsWeek1);
    }
  }

  return filtered;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function ScoreTicker() {
  const [games, setGames] = useState<TickerGame[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [seasonType, setSeasonType] = useState<number | null>(null);
  const [currentWeek, setCurrentWeek] = useState<number | null>(null);
  const [currentSeasonType, setCurrentSeasonType] = useState<number | null>(null);
  const [weekOptions, setWeekOptions] = useState<WeekOption[]>([]);
  const [open, setOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const skipCycleRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const visibleOptions =
    currentSeasonType != null && currentWeek != null
      ? filterWeekOptions(weekOptions, currentSeasonType, currentWeek)
      : [];

  useEffect(() => {
    if (skipCycleRef.current) {
      skipCycleRef.current = false;
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const url =
          selectedWeek != null && seasonType != null
            ? `${SCOREBOARD_URL}?week=${selectedWeek}&seasontype=${seasonType}`
            : SCOREBOARD_URL;
        const res = await fetch(url);
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;

        if (!initializedRef.current) {
          const cw = readCurrentWeek(json);
          const cst = readCurrentSeasonType(json);
          setSelectedWeek(cw);
          setSeasonType(cst);
          setCurrentWeek(cw);
          setCurrentSeasonType(cst);
          setWeekOptions(buildWeekOptions(json));
          initializedRef.current = true;
          skipCycleRef.current = true;
        }

        setGames(mapGames(json));
      } catch {
        /* offline or blocked — keep last known scores */
      }
    };

    load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedWeek, seasonType]);

  const nudge = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.7), behavior: "smooth" });
  };

  const handleWeekChange = (value: string) => {
    const [stRaw, wkRaw] = value.split("-");
    const st = Number(stRaw);
    const wk = Number(wkRaw);
    if (Number.isFinite(st) && Number.isFinite(wk)) {
      setSeasonType(st);
      setSelectedWeek(wk);
    }
  };

  if (!games.length) return null;

  const selectValue = selectedWeek != null && seasonType != null ? `${seasonType}-${selectedWeek}` : "";

  const selectedLabel =
    visibleOptions.find((o) => `${o.seasonType}-${o.week}` === selectValue)?.label ??
    (selectedWeek != null ? `Week ${selectedWeek}` : "Week");

  return (
    <div className="relative flex items-stretch border-b border-border bg-primary text-primary-foreground">
      <div ref={dropdownRef} className="relative flex shrink-0 items-stretch border-r border-primary-foreground/15">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Select week"
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex min-w-[120px] items-center justify-between gap-3 rounded-l-md bg-primary px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary-foreground/10 focus:outline-none"
        >
          <span className="whitespace-nowrap">{selectedLabel}</span>
          <ChevronDown
            className={cn("size-3 shrink-0 text-primary-foreground/70 transition-transform", open && "rotate-180")}
          />
        </button>

        {open && (
          <ul
            role="listbox"
            className="absolute top-full left-0 z-50 mt-1 min-w-full overflow-hidden rounded-md border border-primary-foreground/15 bg-primary shadow-lg"
          >
            {visibleOptions.length ? (
              visibleOptions.map((opt) => {
                const value = `${opt.seasonType}-${opt.week}`;
                const active = value === selectValue;
                return (
                  <li key={value} role="option" aria-selected={active}>
                    <button
                      type="button"
                      onClick={() => {
                        handleWeekChange(value);
                        setOpen(false);
                      }}
                      className={cn(
                        "w-full whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary-foreground/10",
                        active && "bg-primary-foreground/10",
                      )}
                    >
                      {opt.label}
                    </button>
                  </li>
                );
              })
            ) : (
              <li className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/70">
                {selectedWeek != null ? `Week ${selectedWeek}` : "Week"}
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="relative min-w-0 flex-1">
        <ScrollButton side="left" onClick={() => nudge(-1)} />
        <div ref={scrollerRef} className="no-scrollbar flex items-stretch gap-0 overflow-x-auto scroll-smooth px-8">
          {games.map((g) => {
            const live = g.state === "in";
            const pre = g.state === "pre";
            return (
              <a
                key={g.id}
                href={g.link}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "flex shrink-0 flex-col justify-center gap-1 border-r border-primary-foreground/15 px-3 py-2 transition-colors hover:bg-primary-foreground/10",
                  live ? "w-[186px]" : pre ? "w-[168px]" : "w-[132px]",
                )}

              >
                <div className="flex items-center justify-between gap-1.5 text-[10px] uppercase tracking-widest text-primary-foreground/70">
                  <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
                    {live ? (
                      <>
                        <span className="font-semibold text-accent">{g.period}</span>
                        <span className="text-primary-foreground"> {g.clock}</span>
                      </>
                    ) : pre ? (
                      g.kickoff || g.detail
                    ) : (
                      g.detail
                    )}
                  </span>
                  {g.network && g.state !== "post" && (
                    <span className="min-w-0 flex-1 truncate text-right text-primary-foreground/60">
                      {truncateNetwork(g.network)}
                    </span>
                  )}
                </div>

                <TeamRow team={g.away} live={live} pre={pre} extra={live ? g.downDistance : ""} />
                <TeamRow team={g.home} live={live} pre={pre} extra={live ? g.ballOn : ""} />
              </a>
            );
          })}
        </div>
        <ScrollButton side="right" onClick={() => nudge(1)} />
      </div>
    </div>
  );
}

function ScrollButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Scroll scores left" : "Scroll scores right"}
      className={cn(
        "absolute top-0 z-10 flex h-full w-8 items-center justify-center bg-primary/95 text-primary-foreground/80 transition-colors hover:text-primary-foreground",
        side === "left" ? "left-0" : "right-0",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

function TeamRow({ team, live, pre, extra }: { team: TickerTeam; live: boolean; pre: boolean; extra?: string }) {
  return (
    <div className={cn("grid items-center gap-1.5", live ? "grid-cols-[1fr_40px_52px]" : "grid-cols-[1fr_auto]")}>
      <div className="flex min-w-0 items-center gap-1.5">

        {team.logo && (
          <img
            src={team.logo}
            alt={`${team.abbr} logo`}
            loading="lazy"
            className="size-4 shrink-0"
            onError={(e) => {
              e.currentTarget.style.visibility = "hidden";
            }}
          />
        )}
        <span className="truncate font-display text-xs uppercase tracking-wide">{team.abbr}</span>
        {live && (
          <span
            className={cn(
              "ml-0.5 size-1.5 shrink-0 rounded-full",
              team.possession ? "bg-accent" : "bg-transparent",
            )}
            aria-hidden={!team.possession}
            title={team.possession ? "Has possession" : undefined}
          />
        )}
      </div>

      {!pre ? (
        <span className="tabnum text-right text-xs font-semibold">{team.score}</span>
      ) : (
        <span className="tabnum text-right text-[10px] text-primary-foreground/60">{team.record}</span>
      )}

      {live && (
        <div className="relative flex h-5 items-center pl-1.5">
          <div className="absolute left-0 top-1/2 h-4 w-px -translate-y-1/2 bg-primary-foreground/10" />
          <span className="truncate text-left text-[9px] uppercase tracking-wider text-primary-foreground/70">
            {extra || ""}
          </span>
        </div>
      )}
    </div>
  );
}
