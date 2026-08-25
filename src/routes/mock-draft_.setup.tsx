import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Link2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { rosterSize } from "@/lib/draft";
import { getLeagueSync, getUserLeagues } from "@/lib/league.functions";
import type { LeagueSummary } from "@/lib/league.server";
import {
  DEFAULT_MOCK_CONFIG,
  PLAYOFF_WEEKS,
  ROSTER_FIELDS,
  SCORING_CHOICES,
  TEAM_CHOICES,
  TIMER_CHOICES,
  loadMockConfig,
  saveMockConfig,
  type MockConfig,
} from "@/lib/mock-config";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/mock-draft_/setup")({
  head: () => ({
    meta: [
      { title: "Mock Draft Setup — The League Office" },
      {
        name: "description",
        content:
          "Configure your fantasy football mock draft: league size, draft slot, snake or linear order, scoring, pick timer, roster slots and playoff start week.",
      },
      { property: "og:title", content: "Mock Draft Setup — The League Office" },
      {
        property: "og:description",
        content:
          "Build your mock draft board before the clock starts — league size, draft slot, scoring and roster configuration.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MockDraftSetupPage,
});

function MockDraftSetupPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [config, setConfig] = useState<MockConfig>(
    () => loadMockConfig() ?? DEFAULT_MOCK_CONFIG,
  );
  const [touchedName, setTouchedName] = useState(false);

  // Default the team name to the signed-in profile name.
  useEffect(() => {
    if (touchedName) return;
    const full = (user?.user_metadata as { full_name?: string } | undefined)?.full_name;
    if (full && config.teamName === DEFAULT_MOCK_CONFIG.teamName) {
      setConfig((c) => ({ ...c, teamName: full }));
    }
  }, [user, touchedName, config.teamName]);

  const patch = (p: Partial<MockConfig>) => setConfig((c) => ({ ...c, ...p }));

  const begin = () => {
    const clean: MockConfig = {
      ...config,
      teamName: config.teamName.trim() || "My Team",
      slot: Math.min(Math.max(1, config.slot), config.teams),
    };
    saveMockConfig(clean);
    navigate({ to: "/mock-draft" });
  };

  return (
    <main className="min-h-screen bg-[hsl(0_0%_98%)]">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-8">
        <header className="mb-6">
          <h1 className="display-title text-4xl">
            Mock Draft <span className="text-primary">Setup</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure the room, then start the clock.
          </p>
        </header>

        <div className="grid gap-5 lg:grid-cols-[65fr_35fr] lg:items-start">
          {/* Left column — configuration */}
          <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
            <Field label="Team Name" htmlFor="ms-team">
              <Input
                id="ms-team"
                value={config.teamName}
                placeholder="Your team name"
                onChange={(e) => {
                  setTouchedName(true);
                  patch({ teamName: e.target.value });
                }}
              />
            </Field>

            <Field label="Amount of Teams">
              <div className="flex flex-wrap gap-2">
                {TEAM_CHOICES.map((n) => (
                  <Choice
                    key={n}
                    active={config.teams === n}
                    onClick={() => patch({ teams: n, slot: Math.min(config.slot, n) })}
                  >
                    {n}
                  </Choice>
                ))}
              </div>
            </Field>

            <Field label="Draft Slot Position">
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: config.teams }, (_, i) => i + 1).map((s) => (
                  <Choice key={s} active={config.slot === s} onClick={() => patch({ slot: s })}>
                    {s}
                  </Choice>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Slots available: 1–{config.teams}
              </p>
            </Field>

            <Field label="Draft Type">
              <div className="flex gap-2">
                <Choice active={config.snake} onClick={() => patch({ snake: true })} wide>
                  Snake Draft
                </Choice>
                <Choice active={!config.snake} onClick={() => patch({ snake: false })} wide>
                  Linear Draft
                </Choice>
              </div>
            </Field>

            <Field label="Scoring System">
              <div className="flex flex-wrap gap-2">
                {SCORING_CHOICES.map((s) => (
                  <Choice
                    key={s.key}
                    active={config.scoring === s.key}
                    onClick={() => patch({ scoring: s.key })}
                    wide
                  >
                    {s.label}
                  </Choice>
                ))}
              </div>
            </Field>

            <Field label="Pick Timer" htmlFor="ms-timer">
              <select
                id="ms-timer"
                value={config.timerLabel}
                onChange={(e) => patch({ timerLabel: e.target.value })}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {TIMER_CHOICES.map((t) => (
                  <option key={t.label} value={t.label}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Roster Positions Setup">
              <div className="grid grid-cols-4 gap-2 rounded-lg border border-border bg-background p-3 sm:grid-cols-8">
                {ROSTER_FIELDS.map((f) => (
                  <div key={f.key} className="space-y-1">
                    <span className="block text-[10px] uppercase tracking-widest text-muted-foreground">
                      {f.label}
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={12}
                      value={config.roster[f.key]}
                      onChange={(e) =>
                        patch({
                          roster: {
                            ...config.roster,
                            [f.key]: Math.max(0, Math.min(12, Number(e.target.value) || 0)),
                          },
                        })
                      }
                      className="tabnum h-9 w-full rounded-md border border-input bg-background px-1 text-center text-sm"
                    />
                  </div>
                ))}
              </div>
              <p className="tabnum mt-1 text-[11px] text-muted-foreground">
                {rosterSize(config.roster)} rounds · {rosterSize(config.roster) * config.teams}{" "}
                total picks
              </p>
            </Field>

            <Field label="Playoffs Start Week" htmlFor="ms-playoffs">
              <select
                id="ms-playoffs"
                value={config.playoffsStartWeek}
                onChange={(e) => patch({ playoffsStartWeek: Number(e.target.value) })}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {PLAYOFF_WEEKS.map((w) => (
                  <option key={w} value={w}>
                    Week {w}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Regular season simulates {config.playoffsStartWeek - 1} weeks.
              </p>
            </Field>

            <Button
              size="lg"
              className="mt-2 w-full font-display text-base uppercase tracking-wide"
              onClick={begin}
            >
              Begin Mock Draft
            </Button>
          </div>

          {/* Right column — Sleeper sync */}
          <SleeperSyncCard config={config} setConfig={setConfig} />
        </div>
      </div>
    </main>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={htmlFor}
        className="font-display text-xs uppercase tracking-widest text-muted-foreground"
      >
        {label}
      </Label>
      {children}
    </div>
  );
}

function Choice({
  active,
  onClick,
  wide,
  children,
}: {
  active: boolean;
  onClick: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-2 font-display text-sm tracking-wide transition-colors",
        wide ? "flex-1 min-w-[110px]" : "min-w-[46px]",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function SleeperSyncCard({
  config,
  setConfig,
}: {
  config: MockConfig;
  setConfig: (updater: (c: MockConfig) => MockConfig) => void;
}) {
  const [username, setUsername] = useState("");
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const leaguesM = useMutation({
    mutationFn: (name: string) => getUserLeagues({ data: { username: name } }),
  });
  const syncM = useMutation({
    mutationFn: (vars: { leagueId: string }) => getLeagueSync({ data: vars }),
  });

  const findLeagues = async () => {
    setNote(null);
    setLeagues([]);
    const res = await leaguesM.mutateAsync(username.trim());
    if (!res.length) return setNote("No leagues found for that Sleeper username.");
    if (res.length === 1) return applyLeague(res[0]!.id, res[0]!.name);
    setLeagues(res);
  };

  // Settings only: scoring, roster slots, league size. Team names are skipped.
  const applyLeague = async (leagueId: string, name: string) => {
    const res = await syncM.mutateAsync({ leagueId });
    if (!res) return setNote("Couldn't load that league.");
    const teams = TEAM_CHOICES.includes(res.teams)
      ? res.teams
      : Math.min(16, Math.max(8, res.teams));
    setConfig((c) => ({
      ...c,
      teams,
      slot: Math.min(c.slot, teams),
      scoring: res.scoring,
      roster: { ...c.roster, ...res.roster },
    }));
    setLeagues([]);
    setNote(`Imported settings from ${res.league.name || name} (team names skipped).`);
  };

  const busy = leaguesM.isPending || syncM.isPending;

  return (
    <aside className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Link2 className="size-4 text-primary" />
        <h2 className="font-display text-sm uppercase tracking-widest">Sleeper League Sync</h2>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Imports scoring, roster slots and league size only — team names stay local.
      </p>
      <div className="mt-3 flex gap-2">
        <Input
          value={username}
          placeholder="Sleeper username"
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && username.trim() && void findLeagues()}
        />
        <Button type="button" disabled={busy || !username.trim()} onClick={() => void findLeagues()}>
          {busy ? "…" : "Load"}
        </Button>
      </div>
      {leagues.length > 0 && (
        <ul className="mt-3 space-y-1">
          {leagues.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => void applyLeague(l.id, l.name)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-left transition-colors hover:border-primary"
              >
                <div className="truncate font-display text-sm">{l.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {l.season} · {l.teams} teams · {l.scoring}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="mt-3 text-[11px] text-muted-foreground">{note}</p>}

      <dl className="mt-5 space-y-2 border-t border-border pt-4 text-xs">
        <Row label="League size" value={`${config.teams} teams`} />
        <Row label="Draft type" value={config.snake ? "Snake" : "Linear"} />
        <Row label="Rounds" value={String(rosterSize(config.roster))} />
        <Row label="Playoffs" value={`Week ${config.playoffsStartWeek}`} />
      </dl>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd className="tabnum font-semibold">{value}</dd>
    </div>
  );
}
