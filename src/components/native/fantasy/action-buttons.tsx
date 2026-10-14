import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ArrowLeftRight, Minus, Plus } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Mobile-inspired action chrome for desktop Fantasy (native leagues).
 * Uses the same green/orange/teal tones as mobile confirm / Optimize —
 * without mobile-theme CSS variables.
 */

export const fantasyAddBtn =
  "inline-flex items-center justify-center gap-1 rounded-md border border-[#1fae5b] bg-[#1fae5b] px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white shadow-[inset_0_-2px_0_#168444] transition-colors hover:bg-[#1a9a50] disabled:cursor-not-allowed disabled:opacity-50";

export const fantasyDropBtn =
  "inline-flex items-center justify-center gap-1 rounded-md border border-[#e8551f] bg-[#e8551f] px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white shadow-[inset_0_-2px_0_#b83d10] transition-colors hover:bg-[#d14a18] disabled:cursor-not-allowed disabled:opacity-50";

export const fantasyTradeBtn =
  "inline-flex items-center justify-center gap-1 rounded-md border border-[#f08a24] bg-[#f08a24] px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white shadow-[inset_0_-2px_0_#c96a12] transition-colors hover:bg-[#e07c1a] disabled:cursor-not-allowed disabled:opacity-50";

export const fantasySaveLineupBtn =
  "inline-flex items-center justify-center rounded-[14px] bg-[#2d5a47] px-5 py-2.5 font-display text-sm font-extrabold italic uppercase tracking-wide text-white shadow-[0_3px_0_0_#1a3d2e,0_6px_12px_rgba(0,0,0,0.12)] transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode };

export function FantasyAddButton({ className, children = "Add", ...rest }: BtnProps) {
  return (
    <button type="button" className={cn(fantasyAddBtn, className)} {...rest}>
      <Plus className="size-3.5" aria-hidden="true" />
      {children}
    </button>
  );
}

export function FantasyDropButton({ className, children = "Drop", ...rest }: BtnProps) {
  return (
    <button type="button" className={cn(fantasyDropBtn, className)} {...rest}>
      <Minus className="size-3.5" aria-hidden="true" />
      {children}
    </button>
  );
}

export function FantasyTradeButton({ className, children = "Trade", ...rest }: BtnProps) {
  return (
    <button type="button" className={cn(fantasyTradeBtn, className)} {...rest}>
      <ArrowLeftRight className="size-3.5" aria-hidden="true" />
      {children}
    </button>
  );
}

export function FantasySaveLineupButton({ className, children = "Save Lineup", ...rest }: BtnProps) {
  return (
    <button type="button" className={cn(fantasySaveLineupBtn, className)} {...rest}>
      {children}
    </button>
  );
}

type OptimizeProps = BtnProps & {
  gain?: number | null;
  busy?: boolean;
};

/** Two-tone Optimize control matching mobile Team (gain + label). */
export function FantasyOptimizeButton({
  gain,
  busy,
  className,
  disabled,
  ...rest
}: OptimizeProps) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={cn(
        "relative inline-flex h-11 max-w-full items-stretch overflow-hidden rounded-[14px]",
        "shadow-[0_3px_0_0_#1a3d2e,0_6px_12px_rgba(0,0,0,0.18)] disabled:opacity-60",
        className,
      )}
      {...rest}
    >
      {gain != null && Number.isFinite(gain) ? (
        <span className="flex h-full shrink-0 items-center whitespace-nowrap bg-[#76c78c] px-3.5 font-display text-xl font-extrabold italic leading-none tabular-nums text-white">
          +{gain.toFixed(2)}
        </span>
      ) : null}
      <span className="flex h-full items-center whitespace-nowrap bg-[#2d5a47] px-4 font-display text-[15px] font-extrabold italic uppercase tracking-wide text-white">
        {busy ? "Saving…" : "Optimize"}
      </span>
    </button>
  );
}
