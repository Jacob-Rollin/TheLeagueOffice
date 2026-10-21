import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { fantasyOutlineBtn } from "@/components/native/fantasy/chrome";
import { cn } from "@/lib/utils";

/** Above the desktop player popup (z-50). */
const OVERLAY_Z = "z-[70]";

export type DesktopDialogSize = "md" | "lg" | "xl";

const CONFIRM_SIZE: Record<DesktopDialogSize, string> = {
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-3xl",
};

const PICKER_SIZE: Record<"lg" | "xl", string> = {
  lg: "max-w-lg",
  xl: "max-w-3xl",
};

function useLockBodyScroll(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}

/**
 * Broadcast-styled centered confirm for desktop Fantasy roster actions
 * (add/drop/trade). Same role as MobileCenteredConfirm.
 * Use `size="xl"` for trade proposals with give/receive lists.
 */
export function DesktopCenteredConfirm({
  label,
  children,
  className,
  size = "md",
}: {
  label: string;
  children: ReactNode;
  className?: string;
  size?: DesktopDialogSize;
}) {
  useLockBodyScroll(true);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className={cn(
        "fixed inset-0 flex items-center justify-center bg-slate-900/45 px-4 py-6",
        OVERLAY_Z,
      )}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          "flex max-h-[min(90vh,100%)] w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-lg",
          CONFIRM_SIZE[size],
          className,
        )}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Broadcast-styled scrollable picker (choose a drop / trade target).
 * Centered modal — not a full-screen mobile sheet.
 * Use `size="xl"` for long trade-target lists.
 */
export function DesktopRosterPicker({
  title,
  subtitle,
  onClose,
  closeDisabled,
  children,
  size = "lg",
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  children: ReactNode;
  size?: "lg" | "xl";
}) {
  useLockBodyScroll(true);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className={cn(
        "fixed inset-0 flex items-center justify-center bg-slate-900/45 px-4 py-6",
        OVERLAY_Z,
      )}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "flex max-h-[min(90vh,100%)] w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-lg",
          PICKER_SIZE[size],
        )}
      >
        <header className="shrink-0 border-b border-slate-200 px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="display-title text-xl uppercase tracking-wide text-slate-900">
                {title}
              </h3>
              {subtitle ? <div className="mt-1 text-sm text-slate-600">{subtitle}</div> : null}
            </div>
            <button
              type="button"
              disabled={closeDisabled}
              aria-label="Close"
              className={cn(fantasyOutlineBtn, "shrink-0 !px-3 !py-1.5 text-xs")}
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain bg-slate-50/80 px-4 py-4">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Optional icon-only close for nested confirm headers. */
export function DesktopDialogCloseButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label="Close"
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
    >
      <X className="size-4" strokeWidth={2.5} aria-hidden="true" />
    </button>
  );
}
