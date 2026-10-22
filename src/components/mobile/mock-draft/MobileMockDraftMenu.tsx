import { useEffect } from "react";

import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  paused: boolean;
  onClose: () => void;
  onPauseToggle: () => void;
  onEndDraft: () => void;
  onOpenSettings: () => void;
  onDeleteDraft: () => void;
};

/** In-draft overflow menu — solo mock actions only (no share / chat / multiplayer). */
export function MobileMockDraftMenu({
  open,
  paused,
  onClose,
  onPauseToggle,
  onEndDraft,
  onOpenSettings,
  onDeleteDraft,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Draft menu"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 px-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-m-card p-4 text-m-card-fg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-2">
          <MenuBtn onClick={onPauseToggle}>{paused ? "Resume Draft" : "Pause Draft"}</MenuBtn>
          <MenuBtn onClick={onEndDraft}>End Draft</MenuBtn>
          <MenuBtn onClick={onOpenSettings}>Draft Settings</MenuBtn>
          <MenuBtn danger onClick={onDeleteDraft}>
            Delete Draft
          </MenuBtn>
          <MenuBtn onClick={onClose}>Cancel</MenuBtn>
        </div>
      </div>
    </div>
  );
}

function MenuBtn({
  onClick,
  children,
  danger,
}: {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-full bg-m-chip px-4 py-3.5 text-center font-display text-base font-semibold tracking-wide",
        danger ? "text-red-500" : "text-m-chip-fg",
      )}
    >
      {children}
    </button>
  );
}
