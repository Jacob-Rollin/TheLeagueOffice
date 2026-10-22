import { useEffect, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { PlayerDetail } from "./PlayerDetail";
import { hasDesktopOverlay } from "@/lib/desktop-overlay";

export function PlayerModal({
  id,
  onClose,
  onSelectPlayer,
  showDraftActions = false,
  draftRosterLabel,
  sessionDrafted,
  onSessionDraft,
}: {
  id: string | null;
  onClose: () => void;
  onSelectPlayer: (id: string) => void;
  /** When true, render Draft action controls (War Room / Mock Draft only). */
  showDraftActions?: boolean;
  /** Mock Draft owner label; War Room leaves null to hide synced-league ownership. */
  draftRosterLabel?: string | null;
  sessionDrafted?: boolean;
  onSessionDraft?: (playerId: string) => void;
}) {
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Nested compare / roster dialogs own Escape first.
      if (hasDesktopOverlay()) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, onClose]);

  useEffect(() => {
    if (!id) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleGlobalScroll = (e: WheelEvent) => {
      // Nested overlays (compare, add/drop/trade) freeze the player popup —
      // do not redirect wheel into the popup behind them.
      if (hasDesktopOverlay()) return;
      const scrollContainer = document.getElementById("player-popup-scroll-container");
      if (scrollContainer) {
        scrollContainer.scrollTop += e.deltaY;
      }
    };

    // Capture all mouse wheel scrolling activity globally across the monitor canvas
    window.addEventListener("wheel", handleGlobalScroll, { passive: true });

    return () => {
      document.body.style.overflow = originalOverflow || "unset";
      window.removeEventListener("wheel", handleGlobalScroll);
    };
  }, [id]);

  if (!id) return null;
  if (typeof document === "undefined") return null;

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    e.stopPropagation();
    e.preventDefault();
    onClose();
  };

  const handleClose = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onClose();
  };

  // Portal to body so sticky Fantasy rails / site nav stacking contexts cannot
  // trap the overlay (dashboard chat column is lg:sticky).
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/50 p-2 sm:p-6"
      onClick={handleBackdropClick}
    >
      <div
        id="player-popup-scroll-container"
        className="relative h-full max-h-full w-full max-w-5xl overflow-x-visible overflow-y-auto rounded-xl border border-border bg-background shadow-2xl pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero close only — scrolls with the banner. Compact bar owns its own X. */}
        <button
          type="button"
          onMouseDown={handleClose}
          onClick={handleClose}
          className="pointer-events-auto absolute right-4 top-4 z-[200] flex h-8 w-8 cursor-pointer select-none items-center justify-center rounded-lg border border-white/45 bg-transparent text-white transition-colors hover:border-white/80 hover:bg-white/10 focus:outline-none"
          aria-label="Close popup"
        >
          <X className="size-4 shrink-0" strokeWidth={2.5} />
        </button>
        <PlayerDetail
          id={id}
          onSelectPlayer={onSelectPlayer}
          onClose={onClose}
          showDraftActions={showDraftActions}
          draftRosterLabel={showDraftActions ? (draftRosterLabel ?? null) : undefined}
          sessionDrafted={sessionDrafted}
          onSessionDraft={onSessionDraft}
        />
      </div>
    </div>,
    document.body,
  );
}
