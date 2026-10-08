import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { PageTitle } from "@/components/PageTitle";
import { passwordProblems } from "@/components/auth/AuthDialog";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>) => ({
    mode: search["mode"] === "signup" ? ("signup" as const) : ("signin" as const),
  }),
  head: () => ({
    meta: [
      { title: "Sign In — The League Office" },
      {
        name: "description",
        content: "Sign in or create your League Office account to manage your fantasy football leagues.",
      },
      { property: "og:title", content: "Sign In — The League Office" },
      { property: "og:description", content: "Access your fantasy football front office." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

const INVALID_CODE = "Invalid or expired invite code.";
type RpcFn = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

function AuthPage() {
  const { mode } = Route.useSearch();
  const navigate = useNavigate();
  const [isSignup, setIsSignup] = useState(mode === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (isSignup) {
        const code = inviteCode.trim();
        if (!code) {
          setError(INVALID_CODE);
          return;
        }
        const missing = passwordProblems(password);
        if (missing.length > 0) {
          setError(`Password must include ${missing.join(", ")}.`);
          return;
        }

        const rpc = supabase.rpc.bind(supabase) as unknown as RpcFn;
        const { data: valid, error: verifyError } = await rpc("verify_invite_code", { target_code: code });
        if (verifyError || valid !== true) {
          setError(INVALID_CODE);
          return;
        }

        const { error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/confirmed` },
        });
        if (err) throw err;

        const { data: consumed, error: consumeError } = await rpc("consume_invite_code", { target_code: code });
        if (consumeError || consumed !== true) {
          console.warn("[auth] invite consume after signup failed", consumeError);
        }

        setNotice("Account created. Check your email to confirm, then sign in.");
        setIsSignup(false);
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        navigate({ to: "/" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <PageTitle>{isSignup ? "Create Account" : "Sign In"}</PageTitle>
      <p className="mt-1 text-sm text-muted-foreground">
        {isSignup ? "Register with a valid invite code." : "Welcome back to the front office."}
      </p>

      <form onSubmit={submit} className="mt-6 space-y-3 rounded-xl border border-border bg-card p-5">
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
            minLength={isSignup ? 8 : 6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
          />
        </label>
        {isSignup ? (
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Invite code
            <input
              type="text"
              required
              autoComplete="off"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
            />
          </label>
        ) : null}

        {error && <p className="text-sm text-destructive">{error}</p>}
        {notice && <p className="text-sm text-success">{notice}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Working…" : isSignup ? "Create account" : "Sign in"}
        </button>

        <button
          type="button"
          onClick={() => setIsSignup((v) => !v)}
          className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {isSignup ? "Already have an account? Sign in" : "Need an account? Create one"}
        </button>
      </form>
    </main>
  );
}
