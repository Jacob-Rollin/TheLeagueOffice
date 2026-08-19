import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

type TickerTeam = { abbr: string; logo: string; score: string; possession: boolean };
type TickerGame = {
  id: string;
  state: "pre" | "in" | "post";
  detail: string;
  kickoff: string;
  clock: string;
  period: string;
  away: TickerTeam;
  home: TickerTeam;
  link: string;
};

type WeekOption = {
  seasonType: number;
  week: number;
  label: string;
};

/** Scheduled kickoff formatted in the viewer's local timezone, e.g. "SUN 12:00 PM". */
function formatKickoff(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} ${time}`;
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
      };
    };
    const state: TickerGame["state"] =
      type?.state === "in" ? "in" : type?.state === "post" ? "post" : "pre";
    return {
      id: String(ev?.id ?? Math.random()),
      state,
      detail: type?.shortDetail ?? "",
      kickoff: formatKickoff(ev?.date ?? comp?.date),
      clock: status?.displayClock ?? "",
      period: status?.period ? `Q${status.period}` : "",
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
  const calendar: any[] = Array.isArray(json?.leagues?.[0]?.calendar)
    ? json.leagues[0].calendar
    : [];
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
        label: shortLabel(seasonType, week, entry?.label ?? `Week ${week}`),
      });
    }
  }
  return options;
}

function filterWeekOptions(
  options: WeekOption[],
  currentSeasonType: number,
  currentWeek: number,
): WeekOption[] {
  const filtered: WeekOption[] = [];
  for (const opt of options) {
    if (opt.seasonType !== currentSeasonType) continue;
    if (opt.week <= currentWeek || opt.week === currentWeek + 1) {
      filtered.push(opt);
    }
  }

  // Preseason transition: if at the final preseason week, offer Regular Season Week 1.
  if (currentSeasonType === 1) {
    const preseasonWeeks = options
      .filter((o) => o.seasonType === 1)
      .map((o) => o.week);
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
  const scrollerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const skipCycleRef = useRef(false);

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
    el.scrollBy({ left: dir * Math.max(280, el.clientWidth * 0.7), behavior: "smooth" });
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

  const selectValue =
    selectedWeek != null && seasonType != null ? `${seasonType}-${selectedWeek}` : "";

  return (
    <div className="relative flex items-stretch border-b border-border bg-primary text-primary-foreground">
      <div className="relative flex w-[74px] shrink-0 items-center border-r border-primary-foreground/15 px-2">
        <select
          value={selectValue}
          onChange={(e) => handleWeekChange(e.target.value)}
          aria-label="Select week"
          className="w-full cursor-pointer appearance-none bg-transparent pr-4 text-[11px] font-semibold uppercase tracking-wider text-primary-foreground focus:outline-none"
        >
          {visibleOptions.length ? (
            visibleOptions.map((opt) => (
              <option
                key={`${opt.seasonType}-${opt.week}`}
                value={`${opt.seasonType}-${opt.week}`}
                className="bg-primary text-primary-foreground"
              >
                {opt.label}
              </option>
            ))
          ) : (
            <option value={selectValue} className="bg-primary text-primary-foreground">
              {selectedWeek != null ? `WK ${selectedWeek}` : "WEEK"}
            </option>
          )}
        </select>
        <ChevronDown className="pointer-events-none absolute right-1 top-1/2 size-3 -translate-y-1/2 text-primary-foreground/70" />
      </div>

      <div className="relative flex-1">
        <ScrollButton side="left" onClick={() => nudge(-1)} />
        <div
          ref={scrollerRef}
          className="no-scrollbar flex items-stretch gap-0 overflow-x-auto scroll-smooth px-8"
        >
          {games.map((g) => (
            <a
              key={g.id}
              href={g.link}
              target="_blank"
              rel="noreferrer"
              className="flex min-w-[168px] shrink-0 flex-col justify-center gap-1 border-r border-primary-foreground/15 px-3 py-2 transition-colors hover:bg-primary-foreground/10"
            >
              <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-primary-foreground/70">
                <span className="flex items-center gap-1">
                  {g.state === "in" && (
                    <span className="size-1.5 rounded-full bg-accent" aria-hidden />
                  )}
                  {g.state === "in"
                    ? `${g.period} ${g.clock}`.trim()
                    : g.state === "pre"
                      ? g.kickoff || g.detail
                      : g.detail}
                </span>
              </div>
              <TeamRow team={g.away} live={g.state === "in"} pre={g.state === "pre"} />
              <TeamRow team={g.home} live={g.state === "in"} pre={g.state === "pre"} />
            </a>
          ))}
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

function TeamRow({ team, live, pre }: { team: TickerTeam; live: boolean; pre: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
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
      <span className="font-display text-xs uppercase tracking-wide">{team.abbr}</span>
      {live && team.possession && (
        <span
          className="size-1.5 rounded-full bg-accent"
          title="Has possession"
          aria-label="Has possession"
        />
      )}
      {!pre && <span className={cn("tabnum ml-auto text-xs font-semibold")}>{team.score}</span>}
    </div>
  );
}
