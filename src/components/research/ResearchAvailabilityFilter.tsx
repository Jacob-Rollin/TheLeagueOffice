import { startTransition, type ReactNode } from "react";

import { Switch } from "@/components/ui/switch";
import {
  RESEARCH_AVAILABILITY_POOLS,
  type ResearchAvailabilityPool,
} from "@/lib/research-availability";
import { cn } from "@/lib/utils";

type PoolProps = {
  value: ResearchAvailabilityPool;
  onChange: (value: ResearchAvailabilityPool) => void;
  /** Dim when My Team is on — pool is ignored until the switch is off. */
  inactive?: boolean;
  disabled?: boolean;
  className?: string;
};

/** Left-side All · Rostered · Available control for research filter bars. */
export function ResearchAvailabilityPoolFilter({
  value,
  onChange,
  inactive = false,
  disabled = false,
  className,
}: PoolProps) {
  return (
    <div
      role="group"
      aria-label="Availability"
      className={cn(
        "inline-flex h-9 shrink-0 items-center rounded-md border border-slate-200 bg-white p-0.5",
        inactive || disabled ? "opacity-60" : null,
        className,
      )}
    >
      {RESEARCH_AVAILABILITY_POOLS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => startTransition(() => onChange(opt.value))}
            className={cn(
              "h-8 rounded px-2.5 text-xs font-semibold transition-colors",
              active
                ? "bg-blue-600 text-white"
                : "text-slate-600 hover:bg-slate-50 hover:text-blue-700",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

type MyTeamProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
};

/** FantasyPros-style My Team switch — place on the far right of the filter row. */
export function ResearchMyTeamToggle({
  checked,
  onCheckedChange,
  disabled = false,
  className,
}: MyTeamProps) {
  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-center justify-end gap-2",
        disabled ? "opacity-50" : null,
        className,
      )}
    >
      <label
        htmlFor="research-my-team-toggle"
        className="cursor-pointer select-none text-sm font-medium text-slate-700"
      >
        My Team
      </label>
      <Switch
        id="research-my-team-toggle"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => startTransition(() => onCheckedChange(next))}
        aria-label="Show only my team"
      />
    </div>
  );
}

type TrailingProps = {
  myTeamOnly: boolean;
  onMyTeamChange: (checked: boolean) => void;
  myTeamDisabled?: boolean;
  /** Search input (or other trailing controls) stacked under My Team. */
  children?: ReactNode;
  className?: string;
};

/**
 * Far-right research filter cluster: My Team on top, optional search below.
 * Use without children when the page has no search in this row.
 */
export function ResearchFilterTrailing({
  myTeamOnly,
  onMyTeamChange,
  myTeamDisabled = false,
  children,
  className,
}: TrailingProps) {
  return (
    <div
      className={cn(
        "flex w-full flex-col items-stretch gap-2 sm:w-auto sm:min-w-[16rem] sm:items-end",
        className,
      )}
    >
      <ResearchMyTeamToggle
        checked={myTeamOnly}
        onCheckedChange={onMyTeamChange}
        disabled={myTeamDisabled}
      />
      {children}
    </div>
  );
}
