import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useMobileTheme } from "@/components/mobile/MobileThemeContext";
import { cn } from "@/lib/utils";

/** Above league bottom nav / activity peek (z-50) so actions stay tappable. */
const OVERLAY_Z = "z-[60]";

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

/** Portals escape MobileShell — re-apply theme tokens so bg-m-* paints opaque. */
function useMobileThemeClass() {
  const { theme } = useMobileTheme();
  return theme === "dark" ? "mobile-theme-dark" : "mobile-theme-light";
}

/**
 * Centered Cancel/Confirm (and similar) dialog for native mobile transactions.
 * Portaled to body so the bottom tab bar cannot clip the action buttons.
 */
export function MobileCenteredConfirm({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  useLockBodyScroll(true);
  const themeClass = useMobileThemeClass();
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className={cn(
        themeClass,
        "fixed inset-0 flex items-center justify-center bg-black/55 px-4 py-6",
        OVERLAY_Z,
      )}
      style={{
        paddingTop: "max(1.5rem, env(safe-area-inset-top, 0px))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          "max-h-[min(85dvh,100%)] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl bg-m-card p-5 text-m-card-fg shadow-lg",
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
 * Full-screen scrollable picker (e.g. Choose a drop) for native mobile transactions.
 * Explicit dvh + portaled body mount so the roster list can scroll on iOS.
 * Theme class is required on the portal root — otherwise m-* tokens are unset and
 * the Players page bleeds through a transparent sheet.
 */
export function MobileFullScreenPicker({
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
  const themeClass = useMobileThemeClass();
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className={cn(
        themeClass,
        "fixed inset-0 flex h-[100dvh] max-h-[100dvh] flex-col bg-m-bg text-m-card-fg",
        OVERLAY_Z,
      )}
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div className="mx-auto flex h-full min-h-0 w-full max-w-md flex-1 flex-col bg-m-bg">
        <header className="shrink-0 border-b border-m-border bg-m-card px-4 pb-3 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-2xl font-bold text-m-card-fg">{title}</h3>
              {subtitle ? <div className="mt-1 text-sm text-m-muted">{subtitle}</div> : null}
            </div>
            <button
              type="button"
              disabled={closeDisabled}
              aria-label="Close"
              className="shrink-0 rounded-lg px-3 py-2 font-display text-sm font-semibold text-m-muted disabled:opacity-50"
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 touch-pan-y space-y-2 overflow-y-auto overscroll-contain bg-m-bg px-2.5 py-3 pb-10">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
