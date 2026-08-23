import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { signUpWithInviteCode } from "@/lib/invite.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type AuthMode = "signin" | "signup";

const fieldClass =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring";
const labelClass =
  "block text-xs font-semibold uppercase tracking-wide text-muted-foreground";

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
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
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
        const result = await signUpWithInviteCode({
          data: {
            email: email.trim(),
            password,
            username: username.trim(),
            displayName: displayName.trim(),
            inviteCode: inviteCode.trim(),
          },
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) {
          setNotice("Account created. You can sign in now.");
          setIsSignup(false);
          return;
        }
        onOpenChange(false);
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
            {isSignup
              ? "Registration is invite only. Enter your league invite code to continue."
              : "Welcome back to the front office."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <label className={labelClass}>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={fieldClass}
            />
          </label>

          {isSignup && (
            <>
              <label className={labelClass}>
                Username
                <input
                  type="text"
                  required
                  minLength={2}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={fieldClass}
                />
              </label>
              <label className={labelClass}>
                Display Name
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className={fieldClass}
                />
              </label>
            </>
          )}

          <label className={labelClass}>
            Password
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={fieldClass}
            />
          </label>

          {isSignup && (
            <label className={labelClass}>
              Invite Code
              <input
                type="text"
                required
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                className={`${fieldClass} font-mono uppercase tracking-widest`}
              />
            </label>
          )}

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
            onClick={() => {
              setIsSignup((v) => !v);
              setError(null);
              setNotice(null);
            }}
            className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {isSignup ? "Already have an account? Sign In" : "Need an account? Create Account"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
