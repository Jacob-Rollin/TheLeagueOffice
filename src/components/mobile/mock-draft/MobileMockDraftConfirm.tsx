import { useEffect } from "react";

import { cn } from "@/lib/utils";

export type MockDraftConfirmRequest = {
  title: string;
  message: string;
  /** Primary action label. */
  confirmLabel?: string;
  /** Destructive styling on the confirm button. */
  danger?: boolean;
  onConfirm: () => void;
};

type Props = {
  request: MockDraftConfirmRequest | null;
  onDismiss: () => void;
};

/**
 * In-app confirm / notice sheet — replaces window.confirm / alert on mobile.
 * Matches MobileMockDraftMenu chrome (m-* tokens).
 */
export function MobileMockDraftConfirm({ request, onDismiss }: Props) {
  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, onDismiss]);

  if (!request) return null;

  const confirmLabel = request.confirmLabel ?? "Continue";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mock-draft-confirm-title"
      aria-describedby="mock-draft-confirm-message"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-6"
      onClick={onDismiss}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-m-card p-4 text-m-card-fg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="mock-draft-confirm-title"
          className="font-display text-lg font-bold tracking-wide"
        >
          {request.title}
        </h2>
        <p id="mock-draft-confirm-message" className="mt-2 text-sm leading-snug text-m-muted">
          {request.message}
        </p>
        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={() => {
              const run = request.onConfirm;
              onDismiss();
              run();
            }}
            className={cn(
              "w-full rounded-full px-4 py-3.5 text-center font-display text-base font-semibold tracking-wide",
              request.danger
                ? "bg-m-chip text-red-500"
                : "bg-m-accent text-m-accent-fg",
            )}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="w-full rounded-full bg-m-chip px-4 py-3.5 text-center font-display text-base font-semibold tracking-wide text-m-chip-fg"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

type NoticeProps = {
  message: string | null;
  onDismiss: () => void;
};

/** Simple OK notice (replaces window.alert). */
export function MobileMockDraftNotice({ message, onDismiss }: NoticeProps) {
  useEffect(() => {
    if (!message) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mock-draft-notice-message"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-6"
      onClick={onDismiss}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-m-card p-4 text-m-card-fg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="mock-draft-notice-message" className="text-sm leading-snug text-m-card-fg">
          {message}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-4 w-full rounded-full bg-m-accent px-4 py-3.5 text-center font-display text-base font-semibold tracking-wide text-m-accent-fg"
        >
          OK
        </button>
      </div>
    </div>
  );
}
