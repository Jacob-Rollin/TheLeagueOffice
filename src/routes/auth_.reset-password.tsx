import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";

import { AuthDialog, passwordProblems } from "@/components/auth/AuthDialog";
import { PageTitle } from "@/components/PageTitle";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth_/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset Password — The League Office" },
      { name: "description", content: "Set a new password for your League Office account." },
      { name: "robots", content: "noindex" },
    ],
  }),
  ssr: false,
  component: ResetPasswordPage,
});

const fieldClass =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring";
const labelClass = "block text-xs font-semibold uppercase tracking-wide text-muted-foreground";

type Phase = "checking" | "ready" | "invalid" | "done";

/** Supabase appends link errors (e.g. expired OTP) to the hash or query string. */
function readLinkError(): string | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const description = hash.get("error_description") ?? query.get("error_description");
  if (description) return description.replace(/\+/g, " ");
  if (hash.get("error") || query.get("error")) return "This reset link is invalid or has expired.";
  return null;
}

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("checking");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  // The Supabase client exchanges the emailed token for a recovery session on load.
  useEffect(() => {
    const urlError = readLinkError();
    if (urlError) {
      setLinkError(urlError);
      setPhase("invalid");
      return;
    }

    let settled = false;
    const markReady = () => {
      if (settled) return;
      settled = true;
      setPhase("ready");
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) markReady();
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) markReady();
    });

    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setLinkError("This reset link is invalid or has expired.");
      setPhase("invalid");
    }, 6000);

    return () => {
      window.clearTimeout(timeout);
      sub.subscription.unsubscribe();
    };
  }, []);

  const confirmStatus =
    confirmPassword.length > 0 ? (password === confirmPassword ? "match" : "mismatch") : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const missing = passwordProblems(password);
    if (missing.length > 0) {
      setError(`Password must include ${missing.join(", ")}.`);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setPassword("");
    setConfirmPassword("");
    setPhase("done");
  };

  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <PageTitle>Reset Password</PageTitle>

      {phase === "checking" && (
        <p className="mt-4 text-sm text-muted-foreground">Verifying your reset link…</p>
      )}

      {phase === "invalid" && (
        <div className="mt-6 space-y-4 rounded-xl border border-border bg-card p-5">
          <p className="text-sm text-destructive">{linkError}</p>
          <p className="text-sm text-muted-foreground">
            Reset links expire after a short time and can only be used once. Request a new one from the
            sign in window.
          </p>
          <button
            type="button"
            onClick={() => setAuthOpen(true)}
            className="w-full rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground"
          >
            Open Sign In
          </button>
        </div>
      )}

      {phase === "ready" && (
        <form onSubmit={submit} className="mt-6 space-y-3 rounded-xl border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">Choose a new password for your account.</p>
          <label className={labelClass}>
            New Password
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={fieldClass}
            />
          </label>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            Minimum 8 characters with one uppercase letter, one number, and one special character.
          </p>
          <label className={labelClass}>
            Confirm New Password
            <div className="relative">
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`${fieldClass} pr-10`}
              />
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                {confirmStatus === "match" && (
                  <Check className="size-4 text-emerald-500" aria-label="Passwords match" />
                )}
                {confirmStatus === "mismatch" && (
                  <X className="size-4 text-red-500" aria-label="Passwords do not match" />
                )}
              </div>
            </div>
          </label>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Saving…" : "Update Password"}
          </button>
        </form>
      )}

      {phase === "done" && (
        <div className="mt-6 space-y-4 rounded-xl border border-border bg-card p-5">
          <p className="text-sm text-foreground">Your password has been updated and you are signed in.</p>
          <button
            type="button"
            onClick={() => navigate({ to: "/" })}
            className="w-full rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground"
          >
            Go to Homepage
          </button>
        </div>
      )}

      <AuthDialog open={authOpen} mode="signin" onOpenChange={setAuthOpen} />
    </main>
  );
}
