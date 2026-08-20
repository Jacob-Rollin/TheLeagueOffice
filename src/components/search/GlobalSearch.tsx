import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { PositionBadge } from "@/components/draft/PositionBadge";
import { teamLogo } from "@/components/draft/PlayerAvatar";
import { NFL_TEAMS } from "@/lib/nfl-teams";
import { getPlayers } from "@/lib/players.functions";
import { cn } from "@/lib/utils";

const PAGES: { label: string; to: string; hint: string }[] = [
  { label: "League HQ", to: "/", hint: "Home" },
  { label: "War Room", to: "/draft", hint: "Draft board" },
  { label: "Trade Desk", to: "/trade", hint: "Trade Analyzer" },
  { label: "The Wire", to: "/waiver", hint: "Waivers" },
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

  const empty = active && !pages.length && !teams.length && !players.length;

  const go = (to: string, params?: Record<string, string>) => {
    collapse();
    navigate({ to, params } as never);
  };

  return (
    <div ref={wrapRef} className="relative ml-auto flex items-center">
      <div
        className={cn(
          "flex items-center overflow-hidden rounded-full border transition-all duration-300 ease-in-out",
          open
            ? "w-56 border-primary-foreground/30 bg-primary-foreground/15 sm:w-72"
            : "w-8 border-transparent bg-transparent",
        )}
        style={{ transformOrigin: "right" }}
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
