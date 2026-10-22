import { startTransition, useId, type ReactNode } from "react";

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
  const id = useId();
  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-center justify-end gap-2",
        disabled ? "opacity-50" : null,
        className,
      )}
    >
      <label
        htmlFor={id}
        className="cursor-pointer select-none text-sm font-medium text-slate-700"
      >
        My Team
      </label>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => startTransition(() => onCheckedChange(next))}
        aria-label="Show only my team"
      />
    </div>
  );
}

/** Shared search field classes for the pool/filter row (right side). */
export const RESEARCH_SEARCH_INPUT_CLASS =
  "h-9 w-full max-w-xs rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none ring-primary/30 placeholder:text-slate-400 focus:ring-2 sm:w-64";

type PosRowProps = {
  children: ReactNode;
  myTeamOnly: boolean;
  onMyTeamChange: (checked: boolean) => void;
  myTeamDisabled?: boolean;
  className?: string;
};

/** Top research filter row: position chips (left) + My Team toggle (right). */
export function ResearchPosFilterRow({
  children,
  myTeamOnly,
  onMyTeamChange,
  myTeamDisabled = false,
  className,
}: PosRowProps) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">{children}</div>
      <ResearchMyTeamToggle
        checked={myTeamOnly}
        onCheckedChange={onMyTeamChange}
        disabled={myTeamDisabled}
      />
    </div>
  );
}

type PoolRowProps = {
  children: ReactNode;
  /** Search input (or null when this page searches elsewhere). */
  search?: ReactNode;
  className?: string;
};

/** Second research filter row: All/Rostered/Available + other filters (left), search (right). */
export function ResearchPoolFilterRow({ children, search, className }: PoolRowProps) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
      {search ? <div className="flex w-full justify-end sm:w-auto">{search}</div> : null}
    </div>
  );
}
