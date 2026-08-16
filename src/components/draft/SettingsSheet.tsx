import { Settings2 } from "lucide-react";

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
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  onReset: () => void;
}) {
  const setRoster = (key: keyof RosterSlots, v: number) => {
    const roster = { ...settings.roster, [key]: v };
    update({ roster, rounds: rosterSize(roster) });
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
              <span className="font-display text-sm uppercase tracking-wide">Snake order</span>
              <button
                onClick={() => update({ snake: !settings.snake })}
                className={cn(
                  "rounded-full border px-3 py-1 font-display text-xs uppercase tracking-wide",
                  settings.snake
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground",
                )}
              >
                {settings.snake ? "Snake" : "Linear"}
              </button>
            </div>
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
