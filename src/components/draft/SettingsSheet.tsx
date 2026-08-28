import { GripVertical, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { SyncLock } from "@/components/league/SyncLock";
import { getConnectionSync } from "@/lib/league.functions";
import { platformLabel } from "@/lib/league-link";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SETTINGS,
  rosterSize,
  SCORING_LABEL,
  type RosterSlots,
  type Scoring,
  type Settings,
} from "@/lib/draft";

const ROSTER_KEYS: (keyof RosterSlots)[] = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF", "BENCH"];

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
      <span className="font-display text-sm uppercase tracking-wide">{label}</span>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="icon"
          className="size-8"
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          −
        </Button>
        <span className="tabnum w-8 text-center font-display text-lg">{value}</span>
        <Button
          variant="secondary"
          size="icon"
          className="size-8"
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          +
        </Button>
      </div>
    </div>
  );
}

export function SettingsSheet({
  settings,
  update,
  onReset,
  orderLocked = false,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  onReset: () => void;
  /** Client-side gate; swap for commissioner role checks later. */
  orderLocked?: boolean;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const { activeLeague } = useActiveLeague();
  const { user } = useAuth();
  // Baseline captured from the synced league configuration on first render.
  const syncedRef = useRef<Settings>(settings);
  const appliedRef = useRef<string | null>(null);
  const modified = JSON.stringify(syncedRef.current) !== JSON.stringify(settings);

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

  // Populate the form instantly whenever synced league data loads or changes.
  useEffect(() => {
    const id = activeLeague?.id ?? null;
    if (!id || !synced) return;
    const teams = Number(synced?.teams) || DEFAULT_SETTINGS.teams;
    const roster = (synced?.roster ?? DEFAULT_SETTINGS.roster) as RosterSlots;
    // ROUNDS always snaps to the synced total roster slot capacity.
    const rounds = rosterSize(roster) || Number(synced?.rounds) || DEFAULT_SETTINGS.rounds;
    const signature = `${id}:${JSON.stringify([teams, rounds, synced?.myTeam, synced?.scoring, synced?.snake, roster, synced?.teamNames])}`;
    if (appliedRef.current === signature) return;
    appliedRef.current = signature;
    const patch: Partial<Settings> = {
      teams,
      rounds,
      myTeam: Math.min(Math.max(Number(synced?.myTeam) || 1, 1), teams),
      scoring: synced?.scoring ?? DEFAULT_SETTINGS.scoring,
      snake: Boolean(synced?.snake ?? DEFAULT_SETTINGS.snake),
      roster,
      teamNames: synced?.teamNames ?? {},
    };
    syncedRef.current = { ...settings, ...patch } as Settings;
    update(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synced, activeLeague?.id]);

  const setRoster = (key: keyof RosterSlots, v: number) => {
    const roster = { ...settings.roster, [key]: v };
    update({ roster, rounds: rosterSize(roster) });
  };

  /** Move a 1-based draft slot to a new position, remapping names + my slot. */
  const moveTeam = (from: number, to: number) => {
    if (orderLocked || from === to) return;
    const slots = Array.from({ length: settings.teams }, (_, i) => i + 1);
    const [moved] = slots.splice(from, 1);
    slots.splice(to, 0, moved!);
    const names: Record<string, string> = {};
    slots.forEach((oldSlot, i) => {
      const n = settings.teamNames?.[String(oldSlot)];
      if (n) names[String(i + 1)] = n;
    });
    const myIdx = slots.indexOf(settings.myTeam);
    update({ teamNames: names, myTeam: myIdx === -1 ? settings.myTeam : myIdx + 1 });
  };


  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="secondary" size="sm" className="gap-1.5">
          <Settings2 className="size-4" />
          League
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="display-title text-2xl">League settings</SheetTitle>
          <SheetDescription>
            Changing roster slots updates the number of rounds automatically.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-10">
          {activeLeague ? (
            <section className="space-y-1 rounded-lg border border-border bg-card px-3 py-3">
              <h3 className="font-display text-xs uppercase tracking-widest text-muted-foreground">
                Connected Sync Data
              </h3>
              <p className="text-sm font-semibold text-black">
                {activeLeague?.name ?? "League"}{" "}
                <span className="font-normal text-muted-foreground">
                  [{platformLabel(activeLeague?.platform)}]
                </span>
              </p>
              <p className="text-xs text-black">{activeLeague?.teamName ?? "Your team"}</p>
              {modified && (
                <div className="pt-2">
                  <p className="text-xs font-semibold text-red-600">Status: Custom Settings (Modified)</p>
                  <button
                    type="button"
                    onClick={() => update(syncedRef.current)}
                    className="mt-1 text-xs font-semibold text-black underline underline-offset-4"
                  >
                    Restore Synced Defaults
                  </button>
                </div>
              )}
            </section>
          ) : (
            <SyncLock authenticated={Boolean(user)} rows={3}>
              <section className="space-y-1 px-3 py-3">
                <h3 className="font-display text-xs uppercase tracking-widest text-muted-foreground">
                  Connected Sync Data
                </h3>
                <p className="text-sm font-semibold">League</p>
                <p className="text-xs">Your team</p>
              </section>
            </SyncLock>
          )}


          <section className="space-y-2">
            <h3 className="font-display text-xs uppercase tracking-widest text-muted-foreground">
              Scoring
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(SCORING_LABEL) as Scoring[]).map((s) => (
                <button
                  key={s}
                  onClick={() => update({ scoring: s })}
                  className={cn(
                    "rounded-lg border px-2 py-2 font-display text-sm uppercase tracking-wide transition-colors",
                    settings.scoring === s
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {SCORING_LABEL[s]}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-display text-xs uppercase tracking-widest text-muted-foreground">
              Draft
            </h3>
            <Stepper
              label="Teams"
              value={settings.teams}
              min={4}
              max={20}
              onChange={(v) =>
                update({ teams: v, myTeam: Math.min(settings.myTeam, v) })
              }
            />
            <Stepper
              label="Rounds"
              value={settings.rounds}
              min={1}
              max={30}
              onChange={(v) => update({ rounds: v })}
            />
            <Stepper
              label="My draft slot"
              value={settings.myTeam}
              min={1}
              max={settings.teams}
              onChange={(v) => update({ myTeam: v })}
            />
            <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
              <span className="font-display text-sm uppercase tracking-wide">Draft type</span>
              <div className="flex items-center gap-2">
                {([
                  ["Snake", true],
                  ["Linear", false],
                ] as const).map(([label, val]) => (
                  <button
                    key={label}
                    onClick={() => update({ snake: val })}
                    className={cn(
                      "rounded-md border px-3 py-1 font-display text-xs uppercase tracking-wide",
                      settings.snake === val
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-display text-xs uppercase tracking-widest text-muted-foreground">
              Team names
            </h3>
            {Array.from({ length: settings.teams }, (_, i) => i + 1).map((t) => (
              <div
                key={t}
                draggable={!orderLocked}
                onDragStart={() => setDragIndex(t - 1)}
                onDragOver={(e) => {
                  if (!orderLocked && dragIndex !== null) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null) moveTeam(dragIndex, t - 1);
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2",
                  !orderLocked && "cursor-grab active:cursor-grabbing",
                  dragIndex === t - 1 && "opacity-50",
                )}
              >
                {!orderLocked && (
                  <GripVertical
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <span className="tabnum w-6 shrink-0 font-display text-sm text-muted-foreground">
                  {t}
                </span>
                <input
                  value={settings.teamNames?.[String(t)] ?? ""}
                  placeholder={`Team ${t}`}
                  onChange={(e) =>
                    update({
                      teamNames: { ...(settings.teamNames ?? {}), [String(t)]: e.target.value },
                    })
                  }
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                {t === settings.myTeam && (
                  <span className="font-display text-[10px] uppercase tracking-wide text-primary">
                    You
                  </span>
                )}
              </div>
            ))}
            {orderLocked && (
              <p className="pt-1 text-xs text-muted-foreground/70">
                Draft order locked. Clear and restart the draft to re-order teams.
              </p>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="font-display text-xs uppercase tracking-widest text-muted-foreground">
              Roster positions
            </h3>
            {ROSTER_KEYS.map((k) => (
              <Stepper
                key={k}
                label={k === "BENCH" ? "Bench" : k}
                value={settings.roster[k]}
                min={0}
                max={12}
                onChange={(v) => setRoster(k, v)}
              />
            ))}
          </section>

          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => update(DEFAULT_SETTINGS)}>
              Restore defaults
            </Button>
            <Button variant="destructive" className="flex-1" onClick={onReset}>
              Clear draft
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
