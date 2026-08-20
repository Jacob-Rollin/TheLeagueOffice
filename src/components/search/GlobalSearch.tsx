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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const term = q.trim().toLowerCase();

  const pages = useMemo(
    () =>
      term
        ? PAGES.filter(
            (p) =>
              p.label.toLowerCase().includes(term) || p.hint.toLowerCase().includes(term),
          )
        : PAGES,
    [term],
  );

  const teams = useMemo(
    () =>
      term
        ? NFL_TEAMS.filter((t) =>
            `${t.city} ${t.name} ${t.id}`.toLowerCase().includes(term),
          ).slice(0, 6)
        : [],
    [term],
  );

  const players = useMemo(() => {
    if (term.length < 2) return [];
    const list = data?.players ?? [];
    return list.filter((p) => p.name.toLowerCase().includes(term)).slice(0, 8);
  }, [term, data]);

  const empty = term.length >= 2 && !pages.length && !teams.length && !players.length;

  const close = () => {
    setOpen(false);
    setQ("");
  };

  const go = (to: string, params?: Record<string, string>) => {
    close();
    navigate({ to, params } as never);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border border-primary-foreground/25 bg-primary-foreground/10 px-3 py-1.5 text-sm text-primary-foreground/70 transition-colors hover:bg-primary-foreground/20 hover:text-primary-foreground"
        aria-label="Search players, teams and pages"
      >
        <Search className="size-4" />
        <span className="hidden sm:inline">Search…</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/20 px-4 pt-24 backdrop-blur-sm"
          onMouseDown={close}
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 text-muted-foreground" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search players, NFL teams or pages…"
                className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={close}
                aria-label="Close search"
                className="rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-2">
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
                    <Row
                      key={t.id}
                      onClick={() => go("/nfl-team/$nflId", { nflId: t.id })}
                    >
                      <img
                        src={teamLogo(t.id) ?? ""}
                        alt=""
                        className="size-6"
                        loading="lazy"
                      />
                      <span className="flex-1 truncate font-medium">
                        {t.city} {t.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t.conference} {t.division}
                      </span>
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
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No matching players or teams found
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <p className="px-3 py-1.5 font-display text-[11px] uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      <ul>{children}</ul>
    </div>
  );
}

function Row({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent",
        )}
      >
        {children}
      </button>
    </li>
  );
}
