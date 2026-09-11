import { useEffect } from "react";

import { PlayerDetail } from "./PlayerDetail";

export function PlayerModal({
  id,
  onClose,
  onSelectPlayer,
  showDraftActions = false,
}: {
  id: string | null;
  onClose: () => void;
  onSelectPlayer: (id: string) => void;
  /** When true, render Draft action controls (War Room / Mock Draft only). */
  showDraftActions?: boolean;
}) {
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, onClose]);

  useEffect(() => {
    if (!id) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleGlobalScroll = (e: WheelEvent) => {
      // Locate our scrollable inner popup modal content container element
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/50 p-2 sm:p-6"
      onClick={onClose}
    >
      <div
        id="player-popup-scroll-container"
        className="relative h-full max-h-full w-full max-w-5xl overflow-x-visible overflow-y-auto rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close player overlay"
          onClick={onClose}
          className="absolute top-4 right-4 z-50 flex h-8 w-8 cursor-pointer select-none items-center justify-center rounded-lg border border-slate-200/80 bg-white text-slate-700 shadow-sm pointer-events-auto transition-all duration-200 hover:bg-slate-50 hover:text-slate-900 focus:outline-none group"
        >
          <svg
            className="h-3.5 w-3.5 text-slate-500 transition-colors group-hover:text-slate-800"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
        <PlayerDetail
          id={id}
          onSelectPlayer={onSelectPlayer}
          onClose={onClose}
          showDraftActions={showDraftActions}
        />
      </div>
    </div>
  );
}
