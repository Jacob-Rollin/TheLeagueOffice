import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SyncLock } from "@/components/league/SyncLock";
import { useActiveLeague, type ActiveLeagueToken } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { rosterSize } from "@/lib/draft";
import { getConnectionSync } from "@/lib/league.functions";
import { platformLabel } from "@/lib/league-link";
import {
  DEFAULT_MOCK_CONFIG,
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
  const { activeLeague } = useActiveLeague();
  // Baseline captured from the synced league payload; used for the status line.
  const syncedRef = useRef<MockConfig | null>(null);
  const appliedRef = useRef<string | null>(null);

  const { data: synced } = useQuery({
    queryKey: ["connection-sync", activeLeague?.id ?? null],
    enabled: Boolean(activeLeague?.leagueId),
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () =>
      await getConnectionSync({
        data: {
          identifier: activeLeague?.leagueId ?? "",
          platform: activeLeague?.platform ?? "sleeper",
          ...(activeLeague?.s2 ? { s2: activeLeague.s2 } : {}),
          ...(activeLeague?.swid ? { swid: activeLeague.swid } : {}),
        },
      }),
  });

  // Auto-populate the left form the moment an active league resolves.
  useEffect(() => {
    const id = activeLeague?.id ?? null;
    if (!id || !synced) return;
    const teams = Number(synced?.teams) || DEFAULT_MOCK_CONFIG.teams;
    const roster = { ...DEFAULT_MOCK_CONFIG.roster, ...(synced?.roster ?? {}) };
    const slot = Math.min(Math.max(Number(synced?.myTeam) || 1, 1), teams);
    const teamName =
      activeLeague?.teamName?.trim() ||
      synced?.teamNames?.[String(slot)] ||
      DEFAULT_MOCK_CONFIG.teamName;
    const next: MockConfig = {
      ...DEFAULT_MOCK_CONFIG,
      teamName,
      teams,
      slot,
      scoring: synced?.scoring ?? DEFAULT_MOCK_CONFIG.scoring,
      snake: Boolean(synced?.snake ?? DEFAULT_MOCK_CONFIG.snake),
      roster,
      playoffsStartWeek:
        Number(synced?.playoffStartWeek) || DEFAULT_MOCK_CONFIG.playoffsStartWeek,
    };
    const signature = `${id}:${JSON.stringify(next)}`;
    if (appliedRef.current === signature) return;
    appliedRef.current = signature;
    syncedRef.current = next;
    setConfig((c) => ({ ...next, timerLabel: c.timerLabel }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synced, activeLeague?.id]);

  // Default the team name to the signed-in profile name.
  useEffect(() => {
    if (touchedName || syncedRef.current) return;
    const full = (user?.user_metadata as { full_name?: string } | undefined)?.full_name;
    if (full && config.teamName === DEFAULT_MOCK_CONFIG.teamName) {
      setConfig((c) => ({ ...c, teamName: full }));
    }
  }, [user, touchedName, config.teamName]);

  const modified = Boolean(
    syncedRef.current &&
      JSON.stringify({ ...syncedRef.current, timerLabel: config.timerLabel }) !==
        JSON.stringify(config),
  );

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

            <Field label="Playoffs Start Week">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background p-3">
                <button
                  type="button"
                  onClick={() =>
                    patch({ playoffsStartWeek: Math.max(1, config.playoffsStartWeek - 1) })
                  }
                  className="h-9 w-9 rounded-md border border-input bg-background text-sm font-display transition-colors hover:text-foreground"
                >
                  −
                </button>
                <div className="tabnum h-9 min-w-[80px] flex-1 rounded-md border border-input bg-background px-1 text-center text-sm leading-9">
                  {config.playoffsStartWeek}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    patch({ playoffsStartWeek: Math.min(18, config.playoffsStartWeek + 1) })
                  }
                  className="h-9 w-9 rounded-md border border-input bg-background text-sm font-display transition-colors hover:text-foreground"
                >
                  +
                </button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Regular season simulates {config.playoffsStartWeek - 1} weeks.
              </p>
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


            <Button
              size="lg"
              className="mt-2 w-full font-display text-base uppercase tracking-wide"
              onClick={begin}
            >
              Begin Mock Draft
            </Button>
          </div>

          {/* Right column — connected sync data */}
          <ConnectedSyncCard
            config={config}
            authenticated={Boolean(user)}
            league={activeLeague}
            modified={modified}
            onRestore={() => syncedRef.current && setConfig(syncedRef.current)}
          />

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

function ConnectedSyncCard({
  config,
  authenticated,
  league,
  modified,
  onRestore,
}: {
  config: MockConfig;
  authenticated: boolean;
  league: ActiveLeagueToken | null;
  modified: boolean;
  onRestore: () => void;
}) {
  return (
    <aside className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      {league ? (
        <div className="space-y-1">
          <h2 className="font-display text-xs uppercase tracking-widest text-muted-foreground">
            Connected Sync Data
          </h2>
          <p className="text-sm font-semibold text-black">
            {league?.name ?? "League"}{" "}
            <span className="font-normal text-muted-foreground">
              [{platformLabel(league?.platform)}]
            </span>
          </p>
          <p className="text-xs text-black">{league?.teamName ?? "Your team"}</p>
          {modified && (
            <div className="pt-2">
              <p className="text-xs font-semibold text-red-600">
                Status: Custom Settings (Modified)
              </p>
              <button
                type="button"
                onClick={onRestore}
                className="mt-1 text-xs font-semibold text-black underline underline-offset-4"
              >
                Restore Synced Defaults
              </button>
            </div>
          )}
        </div>
      ) : (
        <SyncLock authenticated={authenticated} rows={3}>
          <div className="space-y-1 py-3">
            <h2 className="font-display text-xs uppercase tracking-widest text-muted-foreground">
              Connected Sync Data
            </h2>
            <p className="text-sm font-semibold">League</p>
            <p className="text-xs">Your team</p>
          </div>
        </SyncLock>
      )}

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
