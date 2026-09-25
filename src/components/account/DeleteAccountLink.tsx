import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteAccount } from "@/lib/account.functions";
import { supabase } from "@/integrations/supabase/client";

/** Destructive link + Are-you-sure confirmation for permanent account deletion. */
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
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="mt-8 block text-sm font-semibold text-red-600 underline-offset-4 hover:underline"
      >
        Delete Account
      </button>

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !busy) {
            setOpen(false);
            setError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete your account? This permanently removes your
              profile, synced leagues, and login. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600"
              onClick={(event) => {
                event.preventDefault();
                void confirm();
              }}
            >
              {busy ? "Deleting…" : "Delete Account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
