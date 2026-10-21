import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { fantasyOutlineBtn } from "@/components/native/fantasy/chrome";
import { cn } from "@/lib/utils";

/** Above the desktop player popup (z-[60]) and site navbar (z-50). */
const OVERLAY_Z = "z-[70]";

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
 */
export function DesktopCenteredConfirm({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
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
          "max-h-[min(85vh,100%)] w-full max-w-md overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-5 text-slate-900 shadow-lg",
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Broadcast-styled scrollable picker (choose a drop / trade target).
 * Centered modal — not a full-screen mobile sheet.
 */
export function DesktopRosterPicker({
  title,
  subtitle,
  onClose,
  closeDisabled,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  children: ReactNode;
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
        className="flex max-h-[min(88vh,100%)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-lg"
      >
        <header className="shrink-0 border-b border-slate-200 px-5 py-4">
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
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain bg-slate-50/80 px-3 py-3">
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
