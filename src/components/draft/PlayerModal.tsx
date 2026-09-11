import { X } from "lucide-react";
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
          aria-label="Close player"
          onClick={onClose}
          className="absolute right-2 top-2 z-40 rounded-md border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
        <PlayerDetail
          id={id}
          onSelectPlayer={onSelectPlayer}
          showDraftActions={showDraftActions}
        />
      </div>
    </div>
  );
}
