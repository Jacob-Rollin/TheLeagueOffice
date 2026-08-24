import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, X } from "lucide-react";

export type AuthMode = "signin" | "signup";

const fieldClass =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring";
const labelClass = "block text-xs font-semibold uppercase tracking-wide text-muted-foreground";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const INVALID_CODE = "Invalid or expired invite code.";

function passwordProblems(pw: string): string[] {
  const missing: string[] = [];
  if (pw.length < 8) missing.push("at least 8 characters");
  if (!/[A-Z]/.test(pw)) missing.push("one uppercase letter");
  if (!/[0-9]/.test(pw)) missing.push("one number");
  if (!/[^A-Za-z0-9]/.test(pw)) missing.push("one special character (! @ # $ *)");
  return missing;
}

function passwordStrength(pw: string): number {
  if (!pw) return 0;

  // 1. Base rule: If it's too short, it is hard-locked to Level 1
  if (pw.length < 8) return 1;

  // 2. Check each complexity condition individually
  const hasUpper = /[A-Z]/.test(pw);
  const hasNum = /[0-9]/.test(pw);
  const hasSpecial = /[^A-Za-z0-9]/.test(pw);

  // Start with 1 point for satisfying the length requirement
  let score = 1;
  if (hasUpper) score++;
  if (hasNum) score++;
  if (hasSpecial) score++;

  // 3. Natural progression cap: It will step through 2 (Weak) and 3 (Almost)
  // and hit 4 (Secure) only when every single item passes!
  return score;
}

// Spacing labels matching your chosen words perfectly
const strengthLabels = ["Too Short", "Weak", "Almost", "Secure"];
const strengthColors = ["bg-red-500", "bg-amber-500", "bg-yellow-400", "bg-emerald-500"];

type RpcFn = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

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
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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

  const strength = passwordStrength(password);
  const confirmStatus = confirmPassword.length > 0 ? (password === confirmPassword ? "match" : "mismatch") : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (isSignup) {
        const cleanName = name.trim();
        if (!cleanName) {
          setError("Please enter your name.");
          return;
        }
        const cleanEmail = email.trim();
        if (!EMAIL_RE.test(cleanEmail)) {
          setError("Please enter a valid email address.");
          return;
        }
        const missing = passwordProblems(password);
        if (missing.length > 0) {
          setError(`Password must include ${missing.join(", ")}.`);
          return;
        }
        if (password !== confirmPassword) {
          setError("Passwords do not match.");
          return;
        }

        const code = inviteCode.trim();
        if (!code) {
          setError(INVALID_CODE);
          return;
        }

        const rpc = supabase.rpc.bind(supabase) as unknown as RpcFn;
        const { data: consumed, error: rpcError } = await rpc("verify_and_consume_invite_code", { target_code: code });
        if (rpcError || consumed !== true) {
          setError(INVALID_CODE);
          return;
        }

        const { error: signUpError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: {
              name: cleanName,
            },
          },
        });
        if (signUpError) {
          setError(signUpError.message);
          return;
        }

        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
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
          <DialogTitle className="display-title text-2xl">{isSignup ? "Create Account" : "Sign In"}</DialogTitle>
          <DialogDescription>
            {isSignup
              ? "Registration is invite only. Enter your league invite code below."
              : "Welcome back to the front office."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          {isSignup && (
            <label className={labelClass}>
              Name
              <input
                type="text"
                required
                minLength={2}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={fieldClass}
              />
            </label>
          )}

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

          <label className={labelClass}>
            Password
            <input
              type="password"
              required
              minLength={isSignup ? 8 : 6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={fieldClass}
            />
          </label>

          {/* 🌟 MOVED THE LEGEND TEXT DIRECTLY HERE UNDER THE PASSWORD FIELD */}
          {isSignup && (
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
              Minimum 8 characters with one uppercase letter, one number, and one special character.
            </p>
          )}

          {isSignup && (
            <div className="mt-2">
              <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
                <span>Password Strength</span>
                <span>{strengthLabels[strength - 1] ?? "Weak"}</span>
              </div>
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((slot) => (
                  <div
                    key={slot}
                    className={`h-1.5 flex-1 rounded-full transition-colors ${
                      strength >= slot ? strengthColors[strength - 1] : "bg-muted"
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {isSignup && (
            <label className={labelClass}>
              Confirm Password
              <div className="relative">
                <input
                  type="password"
                  required
                  minLength={8}
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
          )}

          {isSignup && (
            <label className={labelClass}>
              Invite Code
              <input
                type="text"
                required
                placeholder="Your personal league invite code"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                className={`${fieldClass} font-mono uppercase tracking-widest`}
              />
            </label>
          )}

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
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
