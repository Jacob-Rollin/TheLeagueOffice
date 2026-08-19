import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
/* eslint-enable @typescript-eslint/no-explicit-any */

export function ScoreTicker() {
  const [games, setGames] = useState<TickerGame[]>([]);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(SCOREBOARD_URL);
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setGames(mapGames(json));
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
  }, []);

  const nudge = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(280, el.clientWidth * 0.7), behavior: "smooth" });
  };

  if (!games.length) return null;

  return (
    <div className="relative border-b border-border bg-primary text-primary-foreground">
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
