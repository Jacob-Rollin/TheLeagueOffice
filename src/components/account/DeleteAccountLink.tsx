import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { deleteAccount } from "@/lib/account.functions";
import { supabase } from "@/integrations/supabase/client";

/** Bright red destructive link + confirmation modal for permanent account deletion. */
export function DeleteAccountLink() {
  const navigate = useNavigate();
  const run = useServerFn(deleteAccount);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await run({ data: undefined } as never);
      await supabase.auth.signOut();
      navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this account.");
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-8 block text-sm font-semibold text-red-600 underline-offset-4 hover:underline"
      >
        Delete Account
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm account deletion"
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6">
            <h3 className="display-title text-lg uppercase tracking-wide">Delete Account</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              This permanently removes your profile, synced leagues and login. This cannot be undone.
            </p>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={confirm}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy ? "Deleting…" : "Delete Account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
