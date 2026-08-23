import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type AuthMode = "signin" | "signup";

export function AuthDialog({
  open,
  mode,
  onOpenChange,
}: {
  open: boolean;
  mode: AuthMode;
  onOpenChange: (open: boolean) => void;
}) {
  const [isSignup, setIsSignup] = useState(mode === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setIsSignup(mode === "signup");
      setError(null);
      setNotice(null);
    }
  }, [open, mode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (isSignup) {
        const { error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        if (err) throw err;
        setNotice("Account created. Check your email to confirm, then sign in.");
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        onOpenChange(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="display-title text-2xl">
            {isSignup ? "Create Account" : "Sign In"}
          </DialogTitle>
          <DialogDescription>
            {isSignup ? "Register to run your leagues." : "Welcome back to the front office."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Password
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
            />
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {notice && <p className="text-sm text-success">{notice}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Working…" : isSignup ? "Create Account" : "Sign In"}
          </button>

          <button
            type="button"
            onClick={() => setIsSignup((v) => !v)}
            className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {isSignup ? "Already have an account? Sign In" : "Need an account? Create Account"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
