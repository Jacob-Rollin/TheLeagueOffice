import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { PositionBadge } from "@/components/draft/PositionBadge";
import { PlayerAvatar, teamLogo } from "@/components/draft/PlayerAvatar";
import { resolveAvatarUrl } from "@/components/playbook/panels";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { getConnectionRosters } from "@/lib/league.functions";
import { NFL_TEAMS } from "@/lib/nfl-teams";
import { getPlayers } from "@/lib/players.functions";
import { cn } from "@/lib/utils";

type LeagueTeamHit = {
  key: string;
  connectionId: string;
  leagueName: string;
  platform: string;
  slot: number;
  team: string;
  owner: string;
  logo: string | null;
  isMine: boolean;
};

const PAGES: { label: string; to: string; hint: string }[] = [
  { label: "Front Office", to: "/", hint: "Home" },
  { label: "Playbook", to: "/playbook", hint: "Active league dashboard" },
  { label: "Standings", to: "/standings", hint: "Actual, All Play, and Power Rankings" },
  { label: "Press Room", to: "/playbook/press-room", hint: "Weekly recap, preview, and waiver notes" },
  { label: "Rosters", to: "/playbook/rosters", hint: "Roster matrix scouting" },
  { label: "Transactions", to: "/playbook/transactions", hint: "League activity" },
  { label: "War Room", to: "/draft", hint: "Draft board" },
  { label: "Mock Draft Simulator", to: "/mock-draft/setup", hint: "Mock draft arena" },
  { label: "Trade Desk", to: "/trade", hint: "Trade Analyzer" },
  { label: "The Wire", to: "/waiver", hint: "Waivers" },
  { label: "Weekly Projections", to: "/weekly-projections", hint: "Week projections by roster ownership" },
  { label: "Season Projections", to: "/season-projections", hint: "Season projections by roster ownership" },
  { label: "Fantasy Leaders", to: "/fantasy-leaders", hint: "Weekly fantasy scoring leaders by position" },
  { label: "Injury Reports", to: "/injury-reports", hint: "Latest NFL injury news and fantasy impact" },
  { label: "Matchups Guide", to: "/matchups-guide", hint: "This week's matchups graded great to tough" },
  { label: "SoS Analysis", to: "/sos-analysis", hint: "Remaining strength of schedule by team and position" },
  { label: "Fantasy Points Allowed", to: "/fantasy-points-allowed", hint: "Defense PA ranks by position" },
  { label: "Red Zone Stats", to: "/red-zone-stats", hint: "Inside-the-20 player stats by position" },
  { label: "Hall of Fame", to: "/hof", hint: "League history" },
];

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ["players"],
    queryFn: () => getPlayers(),
    staleTime: 1000 * 60 * 30,
    enabled: open,
  });

  const { leagues, activeLeagueId, setActiveLeagueId } = useActiveLeague();
  /** Same cache key as useLeagueRosters, so the active league is usually already loaded. */
  const rosterQueries = useQueries({
    queries: leagues.map((league) => ({
      queryKey: ["league-rosters", league.id] as const,
      enabled: open && Boolean(league.leagueId),
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: false,
      queryFn: async () =>
        await getConnectionRosters({
          data: {
            identifier: league.leagueId,
            platform: league.platform,
            ...(league.s2 ? { s2: league.s2 } : {}),
            ...(league.swid ? { swid: league.swid } : {}),
          },
        }),
    })),
  });
  const rosterStamp = rosterQueries.map((q) => q.dataUpdatedAt).join("|");

  const allLeagueTeams = useMemo((): LeagueTeamHit[] => {
    const out: LeagueTeamHit[] = [];
    leagues.forEach((league, i) => {
      for (const t of rosterQueries[i]?.data?.teams ?? []) {
        if (!t) continue;
        out.push({
          key: `${league.id}:${t.slot}`,
          connectionId: league.id,
          leagueName: league.name,
          platform: league.platform,
          slot: Number(t.slot) || 0,
          team: t.team?.trim() || "Team",
          owner: t.owner?.trim() || "",
          logo: t.logo?.trim() || null,
          isMine: Boolean(t.isMine),
        });
      }
    });
    return out;
    // rosterStamp tracks query data changes; the queries array itself is new every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagues, rosterStamp]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) collapse();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") collapse();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const collapse = () => {
    setQ("");
    setOpen(false);
  };

  const term = q.trim().toLowerCase();
  const active = term.length > 0;

  const pages = useMemo(
    () =>
      active
        ? PAGES.filter(
            (p) =>
              p.label.toLowerCase().includes(term) || p.hint.toLowerCase().includes(term),
          )
        : [],
    [term, active],
  );

  const teams = useMemo(
    () =>
      active
        ? NFL_TEAMS.filter((t) =>
            `${t.city} ${t.name} ${t.id}`.toLowerCase().includes(term),
          ).slice(0, 6)
        : [],
    [term, active],
  );

  const players = useMemo(() => {
    if (term.length < 2) return [];
    return (data?.players ?? []).filter((p) => p.name.toLowerCase().includes(term)).slice(0, 8);
  }, [term, data]);

  const leagueTeams = useMemo(() => {
    if (!active) return [];
    return allLeagueTeams
      .filter((t) => `${t.team} ${t.owner}`.toLowerCase().includes(term))
      .sort(
        (a, b) =>
          Number(b.connectionId === activeLeagueId) - Number(a.connectionId === activeLeagueId) ||
          a.team.localeCompare(b.team),
      )
      .slice(0, 8);
  }, [allLeagueTeams, term, active, activeLeagueId]);

  const empty =
    active && !pages.length && !leagueTeams.length && !teams.length && !players.length;

  const go = (to: string, params?: Record<string, string>) => {
    collapse();
    navigate({ to, params } as never);
  };

  const openLeagueTeam = (hit: LeagueTeamHit) => {
    collapse();
    if (hit.connectionId !== activeLeagueId) setActiveLeagueId(hit.connectionId);
    void navigate({ to: "/playbook/rosters", search: { scout: String(hit.slot) } });
  };

  return (
    <div ref={wrapRef} className="relative flex shrink-0 items-center justify-end">
      {/* Reserve the collapsed footprint; the expanded field grows leftward only. */}
      <div className="relative h-8 w-8">
        <div
          className={cn(
            "absolute right-0 top-0 flex h-8 origin-right items-center justify-end overflow-hidden rounded-full border transition-[width,background-color,border-color] duration-300 ease-in-out",
            open
              ? "w-56 border-primary-foreground/30 bg-primary-foreground/15 sm:w-72"
              : "w-8 border-transparent bg-transparent",
          )}
        >
        <button
          type="button"
          onClick={() => (open ? inputRef.current?.focus() : setOpen(true))}
          aria-label="Search teams, players or pages"
          className="grid size-8 shrink-0 place-items-center text-primary-foreground/80 transition-colors hover:text-primary-foreground"
        >
          <Search className="size-4" />
        </button>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search Teams, Players or Pages..."
          tabIndex={open ? 0 : -1}
          className={cn(
            "min-w-0 flex-1 bg-transparent py-1 text-sm text-primary-foreground outline-none placeholder:text-primary-foreground/60",
            !open && "pointer-events-none opacity-0",
          )}
        />
        {open && (
          <button
            type="button"
            onClick={collapse}
            aria-label="Close search"
            className="grid size-8 shrink-0 place-items-center text-primary-foreground/70 hover:text-primary-foreground"
          >
            <X className="size-4" />
          </button>
        )}
        </div>
      </div>

      {open && active && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          <div className="max-h-[70vh] overflow-y-auto py-1 text-foreground">
            {!!pages.length && (
              <Section title="Platform Pages">
                {pages.map((p) => (
                  <Row key={p.to} onClick={() => go(p.to)}>
                    <span className="flex-1 truncate font-medium">{p.label}</span>
                    <span className="text-xs text-muted-foreground">{p.hint}</span>
                  </Row>
                ))}
              </Section>
            )}

            {!!leagueTeams.length && (
              <Section title="League Teams">
                {leagueTeams.map((t) => (
                  <Row key={t.key} onClick={() => openLeagueTeam(t)}>
                    <LeagueTeamAvatar name={t.team} logo={t.logo} platform={t.platform} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{t.team}</span>
                      {t.owner || leagues.length > 1 ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {[t.owner, leagues.length > 1 ? t.leagueName : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      ) : null}
                    </span>
                    {t.isMine ? (
                      <span className="text-xs font-semibold text-primary">My Team</span>
                    ) : null}
                  </Row>
                ))}
              </Section>
            )}

            {!!teams.length && (
              <Section title="NFL Teams">
                {teams.map((t) => (
                  <Row key={t.id} onClick={() => go("/nfl-team/$nflId", { nflId: t.id })}>
                    <img src={teamLogo(t.id) ?? ""} alt="" className="size-5" loading="lazy" />
                    <span className="flex-1 truncate font-medium">
                      {t.city} {t.name}
                    </span>
                    <span className="text-xs text-muted-foreground">{t.id}</span>
                  </Row>
                ))}
              </Section>
            )}

            {!!players.length && (
              <Section title="NFL Players">
                {players.map((p) => (
                  <Row key={p.id} onClick={() => go("/player/$id", { id: p.id })}>
                    <PlayerAvatar
                      id={p.id}
                      pos={p.pos}
                      team={p.team}
                      name={p.name}
                      className="size-8"
                      logoClassName="size-3.5 -bottom-0.5 -right-0.5"
                    />
                    <PositionBadge pos={p.pos} />
                    <span className="flex-1 truncate font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground">{p.team}</span>
                  </Row>
                ))}
              </Section>
            )}

            {term.length >= 2 && !players.length && !data && (
              <p className="px-3 py-2 text-xs text-muted-foreground">Loading players…</p>
            )}

            {empty && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No matching players or teams found
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LeagueTeamAvatar({
  name,
  logo,
  platform,
}: {
  name: string;
  logo: string | null;
  platform: string;
}) {
  const src = resolveAvatarUrl(logo);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const shell =
    "flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted";
  if (src && failedSrc !== src) {
    return (
      <span className={shell}>
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailedSrc(src)}
        />
      </span>
    );
  }
  if (platform.trim().toLowerCase() === "espn") {
    return (
      <span className={shell}>
        <img src="/espn.png" alt="" className="size-5 object-contain" aria-hidden="true" />
      </span>
    );
  }
  const letters = name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "TM";
  return (
    <span className={cn(shell, "text-[10px] font-bold text-muted-foreground")}>{letters}</span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border last:border-0">
      <p className="px-3 py-1.5 font-display text-[11px] uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      <ul className="pb-1">{children}</ul>
    </div>
  );
}

function Row({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
      >
        {children}
      </button>
    </li>
  );
}
