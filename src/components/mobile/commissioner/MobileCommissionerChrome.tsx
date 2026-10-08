import { ChevronLeft, ChevronRight, Info, X } from "lucide-react";
import type { InputHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

export const mOutlineBtn =
  "rounded-lg border border-m-border bg-m-card px-3 py-2 font-display text-sm font-semibold tracking-wide text-m-card-fg disabled:opacity-50";
export const mSaveBtn =
  "rounded-lg bg-m-icon-bg px-3 py-2 font-display text-sm font-semibold uppercase tracking-wide text-m-header-fg disabled:opacity-50";

export function CommishHeader({
  title,
  onClose,
  onBack,
  onSave,
  saving,
  saveDisabled,
}: {
  title: string;
  onClose?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onSave?: (() => void) | undefined;
  saving?: boolean | undefined;
  saveDisabled?: boolean | undefined;
}) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-center border-b border-m-border bg-m-header px-4 py-3 text-m-header-fg">
      {onBack ? (
        <button type="button" onClick={onBack} aria-label="Back" className="absolute left-4 inline-flex size-11 items-center justify-center rounded-lg bg-m-icon-bg text-m-icon-fg">
          <ChevronLeft className="size-6" strokeWidth={2.5} />
        </button>
      ) : (
        <span className="absolute left-4 size-11" aria-hidden />
      )}
      <h1 className="font-display text-xl font-semibold tracking-wide">{title}</h1>
      {onSave ? (
        <button
          type="button"
          onClick={onSave}
          disabled={saving || saveDisabled}
          className={cn(mSaveBtn, "absolute right-4")}
        >
          {saving ? "…" : "Save"}
        </button>
      ) : onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 inline-flex size-11 items-center justify-center rounded-lg bg-m-icon-bg text-m-icon-fg"
        >
          <X className="size-5" strokeWidth={2.5} />
        </button>
      ) : (
        <span className="absolute right-4 size-11" aria-hidden />
      )}
    </header>
  );
}

export function CommishSection({
  title,
  info,
  children,
}: {
  title: string;
  info?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 px-4 py-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-m-card-fg">{title}</h2>
        {info ? (
          <span title={info} className="inline-flex size-6 items-center justify-center rounded-full border border-m-border text-m-muted">
            <Info className="size-3.5" />
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function NavRow({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center justify-between border-b border-m-border px-4 py-4 text-left text-base text-m-card-fg disabled:opacity-50"
    >
      <span>{label}</span>
      <ChevronRight className="size-5 shrink-0 text-m-muted" />
    </button>
  );
}

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-base text-m-card-fg">{label}</p>
        {description ? <p className="mt-0.5 text-sm text-m-muted">{description}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50",
          checked ? "bg-m-accent" : "bg-m-border",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-6 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

export function SegmentedRow<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2 py-2">
      <div>
        <p className="text-base text-m-card-fg">{label}</p>
        {description ? <p className="mt-0.5 text-sm text-m-muted">{description}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50",
                active
                  ? "border-m-accent bg-m-accent/15 text-m-accent"
                  : "border-m-border bg-m-card text-m-card-fg",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="block space-y-1.5 text-sm text-m-muted">{children}</label>;
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded-lg border border-m-border bg-m-bg px-3 py-2.5 text-base text-m-card-fg outline-none focus:border-m-accent disabled:opacity-50",
        props.className,
      )}
    />
  );
}

export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-base text-m-card-fg">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={disabled || value <= min}
          aria-label={`Decrease ${label}`}
          onClick={() => onChange(Math.max(min, value - 1))}
          className="inline-flex size-8 items-center justify-center rounded-full border border-m-border text-lg disabled:opacity-40"
        >
          −
        </button>
        <span className="w-6 text-center font-display text-lg font-semibold">{value}</span>
        <button
          type="button"
          disabled={disabled || value >= max}
          aria-label={`Increase ${label}`}
          onClick={() => onChange(Math.min(max, value + 1))}
          className="inline-flex size-8 items-center justify-center rounded-full bg-m-accent text-lg text-m-accent-fg disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}
