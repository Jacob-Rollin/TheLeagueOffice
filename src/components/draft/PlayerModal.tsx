import { X } from "lucide-react";
import { useEffect } from "react";

import { PlayerDetail } from "./PlayerDetail";

export function PlayerModal({
  id,
  onClose,
  onSelectPlayer,
}: {
  id: string | null;
  onClose: () => void;
  onSelectPlayer: (id: string) => void;
}) {
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, onClose]);

  if (!id) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/50 p-2 sm:p-6"
      onClick={onClose}
    >
      <div
        className="relative max-h-full w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          aria-label="Close player"
          onClick={onClose}
          className="absolute right-2 top-2 z-10 rounded-md border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
        <PlayerDetail id={id} onSelectPlayer={onSelectPlayer} />
      </div>
    </div>
  );
}
