import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const fantasyPrimaryBtn =
  "inline-flex items-center justify-center rounded-md border border-blue-600 bg-blue-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";

export const fantasyOutlineBtn =
  "inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-blue-700 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

type FantasyBoardProps = {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
  bodyClassName?: string | undefined;
};

export function FantasyBoard({ title, action, children, className, bodyClassName }: FantasyBoardProps) {
  const hasHeader = title != null || action != null;
  return (
    <section className={cn("overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm", className)}>
      {hasHeader ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          {title != null ? (
            typeof title === "string" ? (
              <FantasySectionTitle>{title}</FantasySectionTitle>
            ) : (
              title
            )
          ) : (
            <span />
          )}
          {action ?? null}
        </div>
      ) : null}
      <div className={cn(bodyClassName)}>{children}</div>
    </section>
  );
}

export function FantasySectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={cn("text-xs font-bold uppercase tracking-wide text-slate-900", className)}>{children}</h3>
  );
}

type FantasyPosChipProps = {
  label: ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
};

export function FantasyPosChip({ label, active, onClick, className, disabled }: FantasyPosChipProps) {
  const interactive = onClick != null;
  const base =
    "rounded-md border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition-colors";
  const tone = active
    ? "border-blue-600 bg-blue-600 text-white"
    : "border-slate-200 bg-white text-blue-700 hover:border-slate-300";

  if (interactive) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={cn(base, tone, className)}
      >
        {label}
      </button>
    );
  }

  return <span className={cn(base, tone, className)}>{label}</span>;
}

export function FantasyPosChipRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("flex flex-wrap gap-1", className)}>{children}</div>;
}

type FantasyWeekSelectProps = {
  week: number;
  onWeekChange: (week: number) => void;
  maxWeek?: number;
  minWeek?: number;
  label?: string;
  className?: string;
  id?: string;
};

export function FantasyWeekSelect({
  week,
  onWeekChange,
  maxWeek = 18,
  minWeek = 1,
  label = "Week",
  className,
  id = "fantasy-week-select",
}: FantasyWeekSelectProps) {
  const lo = Math.max(1, Math.floor(minWeek));
  const hi = Math.max(lo, Math.floor(maxWeek));
  const options: number[] = [];
  for (let w = lo; w <= hi; w++) options.push(w);

  return (
    <label className={cn("flex flex-col gap-1 text-sm text-slate-700", className)}>
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <select
        id={id}
        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary"
        value={week}
        onChange={(e) => onWeekChange(Number(e.target.value))}
      >
        {options.map((w) => (
          <option key={w} value={w}>
            Week {w}
          </option>
        ))}
      </select>
    </label>
  );
}
