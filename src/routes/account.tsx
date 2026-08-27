import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { AccountShell } from "@/components/account/AccountShell";
import { DeleteAccountLink } from "@/components/account/DeleteAccountLink";

import { useAuth } from "@/hooks/useAuth";
import { AVATAR_CHOICES, useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/account")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Account Settings — The League Office" },
      {
        name: "description",
        content: "Update your League Office profile name, avatar and password.",
      },
      { property: "og:title", content: "Account Settings — The League Office" },
      { property: "og:description", content: "Manage your League Office profile and password." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AccountPage,
});

const inputClass =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring";
const labelClass = "block text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const cardClass = "rounded-xl border border-border bg-card p-6";
const buttonClass =
  "rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-60";

type SubTab = "profile" | "password";

function AccountPage() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [tab, setTab] = useState<SubTab>("profile");

  const tabClass = (value: SubTab) =>
    cn(
      "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
      tab === value
        ? "border-accent text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground",
    );

  return (
    <AccountShell title="Account Settings" active="settings">
      <div className="mb-5 flex gap-2 border-b border-border">
        <button type="button" className={tabClass("profile")} onClick={() => setTab("profile")}>
          Profile
        </button>
        <button type="button" className={tabClass("password")} onClick={() => setTab("password")}>
          Password
        </button>
      </div>

      {tab === "profile" ? (
        <div className="space-y-6">
          <ProfileCard userId={userId} />
          <DeleteAccountLink />
        </div>
      ) : (
        <div className="space-y-6">
          <PasswordCard />
          <DeleteAccountLink />
        </div>
      )}
    </AccountShell>
  );
}

function ProfileCard({ userId }: { userId: string | null }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: profile } = useProfile(userId);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(profile?.full_name ?? "");
  }, [profile?.full_name]);

  useEffect(() => {
    setEmail(user?.email ?? "");
  }, [user?.email]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    const clean = name.trim();
    if (clean.length < 2) {
      setStatus("Please enter at least 2 characters.");
      return;
    }
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.from("profiles").update({ full_name: clean }).eq("id", userId);
    if (!error) await supabase.auth.updateUser({ data: { full_name: clean, name: clean } });

    let message = error ? error.message : "Profile updated.";
    const nextEmail = email.trim();
    if (!error && nextEmail && nextEmail !== user?.email) {
      const { error: emailError } = await supabase.auth.updateUser({ email: nextEmail });
      message = emailError ? emailError.message : "Profile updated. Confirm the new email address.";
    }

    setBusy(false);
    setStatus(message);
    queryClient.invalidateQueries({ queryKey: ["profile", userId] });
  };

  return (
    <section className={cardClass}>
      <form onSubmit={save} className="space-y-4">
        <label className={labelClass}>
          Full Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={cn(inputClass, "max-w-sm")}
            required
            minLength={2}
          />
        </label>
        <label className={labelClass}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={cn(inputClass, "max-w-sm")}
            required
          />
        </label>
        <div>
          <span className={labelClass}>Avatar</span>
          <AvatarRow userId={userId} />
        </div>
        <button type="submit" disabled={busy} className={buttonClass}>
          {busy ? "Saving…" : "Save Profile"}
        </button>
        {status && <p className="text-sm text-muted-foreground">{status}</p>}
      </form>
    </section>
  );
}

function AvatarRow({ userId }: { userId: string | null }) {
  const queryClient = useQueryClient();
  const { data: profile } = useProfile(userId);
  const [status, setStatus] = useState<string | null>(null);

  const pick = async (url: string) => {
    if (!userId) return;
    const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", userId);
    setStatus(error ? error.message : "Avatar updated.");
    queryClient.invalidateQueries({ queryKey: ["profile", userId] });
  };

  return (
    <div>
      <div className="mt-2 flex flex-wrap gap-3">
        {AVATAR_CHOICES.map((choice) => (
          <button
            key={choice.id}
            type="button"
            onClick={() => pick(choice.url)}
            aria-label={`Use ${choice.label} avatar`}
            className={cn(
              "size-14 overflow-hidden rounded-full border-2 transition-colors",
              profile?.avatar_url === choice.url ? "border-accent" : "border-border hover:border-ring",
            )}
          >
            <img src={choice.url} alt="" width={56} height={56} className="size-full object-cover" loading="lazy" />
          </button>
        ))}
      </div>
      {status && <p className="mt-2 text-sm text-muted-foreground">{status}</p>}
    </div>
  );
}


function PasswordCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setStatus("New password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setStatus("Passwords do not match.");
      return;
    }
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.auth.updateUser({ password, current_password: currentPassword } as never);
    setBusy(false);
    if (error) {
      setStatus(error.message);
      return;
    }
    setCurrentPassword("");
    setPassword("");
    setConfirm("");
    setStatus("Password updated.");
  };

  return (
    <section className={cardClass}>
      <h2 className="display-title text-lg uppercase tracking-wide">Password</h2>
      <form onSubmit={submit} className="mt-4 max-w-sm space-y-3">
        <label className={labelClass}>
          Current Password
          <input
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          New Password
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Confirm New Password
          <input
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClass}
          />
        </label>
        <button type="submit" disabled={busy} className={buttonClass}>
          {busy ? "Updating…" : "Change Password"}
        </button>
        {status && <p className="text-sm text-muted-foreground">{status}</p>}
      </form>
    </section>
  );
}
