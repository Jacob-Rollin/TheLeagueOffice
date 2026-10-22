import { Minus, Plus } from "lucide-react";

import {
  PLAYOFF_WEEKS,
  ROSTER_FIELDS,
  SCORING_CHOICES,
  TEAM_CHOICES,
  TIMER_CHOICES,
  type MockConfig,
} from "@/lib/mock-config";
import { rosterSize } from "@/lib/draft";
import { cn } from "@/lib/utils";

import { POS_DOT } from "./posCellStyles";

type Props = {
  config: MockConfig;
  onChange: (next: Partial<MockConfig>) => void;
  onNameTouched?: () => void;
};

/** Current MockConfig fields only — styled for the mobile draft-settings layout. */
export function MobileMockDraftSetupForm({ config, onChange, onNameTouched }: Props) {
  const patch = (p: Partial<MockConfig>) => onChange(p);

  const randomizeSlot = () => {
    const next = 1 + Math.floor(Math.random() * config.teams);
    patch({ slot: next });
  };

  return (
    <div className="space-y-7 px-4 pb-8 pt-2">
      <Section title="Team Name">
        <input
          value={config.teamName}
          placeholder="Team Name"
          onChange={(e) => {
            onNameTouched?.();
            patch({ teamName: e.target.value });
          }}
          className="w-full border-b border-m-border bg-transparent py-2 text-base text-m-card-fg outline-none placeholder:text-m-muted"
        />
      </Section>

      <Section title="Draft Type">
        <div className="flex flex-wrap gap-2">
          <Chip active={config.snake} onClick={() => patch({ snake: true })}>
            Snake
          </Chip>
          <Chip active={!config.snake} onClick={() => patch({ snake: false })}>
            Linear
          </Chip>
        </div>
      </Section>

      <Section title="Scoring (for rankings)">
        <div className="flex flex-wrap gap-2">
          {SCORING_CHOICES.map((s) => (
            <Chip
              key={s.key}
              active={config.scoring === s.key}
              onClick={() => patch({ scoring: s.key })}
            >
              {s.label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Teams">
        <div className="flex flex-wrap gap-2">
          {TEAM_CHOICES.map((n) => (
            <Chip
              key={n}
              active={config.teams === n}
              onClick={() => patch({ teams: n, slot: Math.min(config.slot, n) })}
            >
              {n}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Draft Slot">
        <p className="mb-2 text-sm text-m-muted">Your pick position in round 1.</p>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: config.teams }, (_, i) => i + 1).map((s) => (
            <Chip key={s} active={config.slot === s} onClick={() => patch({ slot: s })}>
              {s}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Time Per Pick">
        <div className="flex flex-wrap gap-2">
          {TIMER_CHOICES.map((t) => (
            <Chip
              key={t.label}
              active={config.timerLabel === t.label}
              onClick={() => patch({ timerLabel: t.label })}
            >
              {t.label === "None"
                ? "No Limit"
                : t.label
                    .replace(" Seconds", "s")
                    .replace(" Minutes", "m")
                    .replace(" Minute", "m")}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Roster">
        <p className="mb-3 text-sm text-m-muted">
          Rds. {rosterSize(config.roster)} —{" "}
          {ROSTER_FIELDS.filter((f) => config.roster[f.key] > 0)
            .map((f) => `${config.roster[f.key]} ${f.label}`)
            .join(", ")}
        </p>
        <ul className="divide-y divide-m-border overflow-hidden rounded-xl border border-m-border bg-m-card">
          {ROSTER_FIELDS.map((f) => (
            <li key={f.key} className="flex items-center gap-3 px-3 py-3">
              <span
                className={cn("size-2.5 shrink-0 rounded-full", POS_DOT[f.key] ?? "bg-m-muted")}
                aria-hidden
              />
              <span className="min-w-0 flex-1 text-sm font-semibold text-m-card-fg">
                {rosterLabel(f.key, f.label)}
              </span>
              <Stepper
                value={config.roster[f.key]}
                onChange={(n) =>
                  patch({
                    roster: {
                      ...config.roster,
                      [f.key]: Math.max(0, Math.min(12, n)),
                    },
                  })
                }
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Playoffs Start Week">
        <div className="flex flex-wrap gap-2">
          {PLAYOFF_WEEKS.map((week) => (
            <Chip
              key={week}
              active={config.playoffsStartWeek === week}
              onClick={() => patch({ playoffsStartWeek: week })}
            >
              {week}
            </Chip>
          ))}
        </div>
        <p className="mt-2 text-xs text-m-muted">Used for post-draft reporting projections.</p>
      </Section>

      <Section title="Draft Order">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm text-m-card-fg">Tap on draft position to set draft order.</p>
          <button
            type="button"
            onClick={randomizeSlot}
            className="shrink-0 rounded-full border border-m-accent px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-wide text-m-accent"
          >
            Randomize
          </button>
        </div>
        <ul className="overflow-hidden rounded-xl border border-m-border bg-m-card">
          {Array.from({ length: config.teams }, (_, i) => i + 1).map((pos) => {
            const isYou = pos === config.slot;
            return (
              <li key={pos}>
                <button
                  type="button"
                  onClick={() => patch({ slot: pos })}
                  className={cn(
                    "flex w-full items-center gap-3 border-b border-m-border px-3 py-3 text-left last:border-b-0",
                    isYou && "bg-m-accent/10",
                  )}
                >
                  <span className="tabnum w-5 text-center text-sm font-bold text-m-card-fg">
                    {pos}
                  </span>
                  <span className="flex size-9 items-center justify-center rounded-full bg-m-chip text-[10px] font-bold text-m-chip-fg">
                    {isYou ? "You" : "AI"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-m-card-fg">
                      {isYou ? config.teamName.trim() || "My Team" : `Team ${pos}`}
                    </span>
                    <span className="block text-[11px] text-m-muted">
                      Draft position #{pos}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}

function rosterLabel(key: string, label: string): string {
  switch (key) {
    case "QB":
      return "Quarterback (QB)";
    case "RB":
      return "Running Back (RB)";
    case "WR":
      return "Wide Receiver (WR)";
    case "TE":
      return "Tight End (TE)";
    case "FLEX":
      return "Flex (W/R/T)";
    case "SUPER_FLEX":
      return "Super Flex (Q/W/R/T)";
    case "K":
      return "Kicker (K)";
    case "DEF":
      return "Defense (DST)";
    case "BENCH":
      return "Bench";
    default:
      return label;
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-m-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Solid accent fill when selected — shared by scoring / type / teams / slot / timer / playoffs. */
function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide transition-colors",
        active
          ? "border-m-accent bg-m-accent text-m-accent-fg"
          : "border-m-border bg-m-card text-m-card-fg",
      )}
    >
      {children}
    </button>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label="Decrease"
        disabled={value <= 0}
        onClick={() => onChange(value - 1)}
        className="inline-flex size-8 items-center justify-center rounded-full bg-m-chip text-m-chip-fg disabled:opacity-40"
      >
        <Minus className="size-4" strokeWidth={2.5} />
      </button>
      <span className="tabnum w-5 text-center text-base font-semibold text-m-card-fg">{value}</span>
      <button
        type="button"
        aria-label="Increase"
        disabled={value >= 12}
        onClick={() => onChange(value + 1)}
        className="inline-flex size-8 items-center justify-center rounded-full bg-m-accent text-m-accent-fg disabled:opacity-40"
      >
        <Plus className="size-4" strokeWidth={2.5} />
      </button>
    </div>
  );
}
