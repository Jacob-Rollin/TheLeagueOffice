import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

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
        content: "Update your League Office profile name, avatar, password, and sync your Sleeper, ESPN or Yahoo leagues.",
      },
      { property: "og:title", content: "Account Settings — The League Office" },
      { property: "og:description", content: "Manage your profile and connected fantasy platforms." },
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

function AccountPage() {
  const { user, ready } = useAuth();
  const userId = user?.id ?? null;

  if (ready && !userId) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-16">
        <h1 className="display-title text-3xl">Account</h1>
        <p className="mt-2 text-sm text-muted-foreground">Sign in from the profile menu to manage your account.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-10">
      <header>
        <h1 className="display-title text-3xl uppercase tracking-wide">Account</h1>
        <p className="mt-1 text-sm text-muted-foreground">{user?.email}</p>
      </header>

      <ProfileCard userId={userId} />
      <AvatarCard userId={userId} />
      <PasswordCard />
      <LeagueSyncCard userId={userId} />
    </main>
  );
}

function ProfileCard({ userId }: { userId: string | null }) {
  const queryClient = useQueryClient();
  const { data: profile } = useProfile(userId);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(profile?.full_name ?? "");
  }, [profile?.full_name]);

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
    setBusy(false);
    setStatus(error ? error.message : "Name updated.");
    queryClient.invalidateQueries({ queryKey: ["profile", userId] });
  };

  return (
    <section className={cardClass}>
      <h2 className="display-title text-lg uppercase tracking-wide">Profile</h2>
      <form onSubmit={save} className="mt-4 max-w-sm space-y-3">
        <label className={labelClass}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required minLength={2} />
        </label>
        <button type="submit" disabled={busy} className={buttonClass}>
          {busy ? "Saving…" : "Save Name"}
        </button>
        {status && <p className="text-sm text-muted-foreground">{status}</p>}
      </form>
    </section>
  );
}

function AvatarCard({ userId }: { userId: string | null }) {
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
    <section className={cardClass}>
      <h2 className="display-title text-lg uppercase tracking-wide">Avatar</h2>
      <p className="mt-1 text-xs text-muted-foreground">Pick a badge for your navbar profile icon.</p>
      <div className="mt-4 flex flex-wrap gap-3">
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
      {status && <p className="mt-3 text-sm text-muted-foreground">{status}</p>}
    </section>
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

type Platform = "sleeper" | "espn" | "yahoo";

type ConnectionRow = {
  id: string;
  platform: string;
  label: string | null;
  sleeper_user_id: string | null;
  espn_league_id: string | null;
  yahoo_league_key: string | null;
};

function LeagueSyncCard({ userId }: { userId: string | null }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Platform>("sleeper");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [sleeperId, setSleeperId] = useState("");
  const [espnLeague, setEspnLeague] = useState("");
  const [espnS2, setEspnS2] = useState("");
  const [espnSwid, setEspnSwid] = useState("");
  const [yahooKey, setYahooKey] = useState("");

  const { data: connections } = useQuery({
    queryKey: ["league-connections", userId],
    enabled: Boolean(userId),
    retry: false,
    queryFn: async (): Promise<ConnectionRow[]> => {
      const { data, error } = await supabase
        .from("league_connections")
        .select("id, platform, label, sleeper_user_id, espn_league_id, yahoo_league_key")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ConnectionRow[];
    },
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    setBusy(true);
    setStatus(null);
    const label =
      tab === "sleeper" ? sleeperId.trim() : tab === "espn" ? espnLeague.trim() : yahooKey.trim();
    const payload: {
      user_id: string;
      platform: string;
      label: string;
      sleeper_user_id: string | null;
      espn_league_id: string | null;
      espn_s2: string | null;
      espn_swid: string | null;
      yahoo_league_key: string | null;
    } = {
      user_id: userId,
      platform: tab,
      label,
      sleeper_user_id: tab === "sleeper" ? label : null,
      espn_league_id: tab === "espn" ? label : null,
      espn_s2: tab === "espn" ? espnS2.trim() || null : null,
      espn_swid: tab === "espn" ? espnSwid.trim() || null : null,
      yahoo_league_key: tab === "yahoo" ? label : null,
    };

    if (!payload.label) {
      setBusy(false);
      setStatus("Enter a league identifier first.");
      return;
    }

    const { error } = await supabase.from("league_connections").insert(payload);
    setBusy(false);
    setStatus(error ? error.message : "League connection saved.");
    if (!error) {
      setSleeperId("");
      setEspnLeague("");
      setEspnS2("");
      setEspnSwid("");
      setYahooKey("");
      queryClient.invalidateQueries({ queryKey: ["league-connections", userId] });
    }
  };

  const remove = async (id: string) => {
    await supabase.from("league_connections").delete().eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["league-connections", userId] });
  };

  const tabClass = (value: Platform) =>
    cn(
      "rounded-md border px-3 py-1.5 font-display text-xs uppercase tracking-wide transition-colors",
      tab === value ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted-foreground",
    );

  return (
    <section className={cardClass}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="display-title text-lg uppercase tracking-wide">Platform League Sync</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Bind your platform league identifiers to this account. No player data is copied to the cloud.
          </p>
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} className={buttonClass}>
          {open ? "Close" : "Sync a New League"}
        </button>
      </div>

      {open && (
        <div className="mt-5 rounded-lg border border-border p-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={tabClass("sleeper")} onClick={() => setTab("sleeper")}>
              Sleeper
            </button>
            <button type="button" className={tabClass("espn")} onClick={() => setTab("espn")}>
              ESPN
            </button>
            <button type="button" className={tabClass("yahoo")} onClick={() => setTab("yahoo")}>
              Yahoo
            </button>
          </div>

          <form onSubmit={save} className="mt-4 max-w-md space-y-3">
            {tab === "sleeper" && (
              <label className={labelClass}>
                Sleeper User Or League ID
                <input value={sleeperId} onChange={(e) => setSleeperId(e.target.value)} className={inputClass} />
              </label>
            )}

            {tab === "espn" && (
              <>
                <label className={labelClass}>
                  ESPN League ID
                  <input value={espnLeague} onChange={(e) => setEspnLeague(e.target.value)} className={inputClass} />
                </label>
                <label className={labelClass}>
                  ESPN_S2
                  <input value={espnS2} onChange={(e) => setEspnS2(e.target.value)} className={inputClass} />
                </label>
                <label className={labelClass}>
                  SWID
                  <input value={espnSwid} onChange={(e) => setEspnSwid(e.target.value)} className={inputClass} />
                </label>
              </>
            )}

            {tab === "yahoo" && (
              <>
                <label className={labelClass}>
                  Yahoo League Key
                  <input value={yahooKey} onChange={(e) => setYahooKey(e.target.value)} className={inputClass} />
                </label>
                <p className="text-xs text-muted-foreground">
                  Yahoo requires an OAuth redirect. Save the league key now and authorize when prompted.
                </p>
              </>
            )}

            <button type="submit" disabled={busy} className={buttonClass}>
              {busy ? "Saving…" : "Save Connection"}
            </button>
            {status && <p className="text-sm text-muted-foreground">{status}</p>}
          </form>
        </div>
      )}

      <ul className="mt-5 space-y-2">
        {(connections ?? []).map((row) => (
          <li
            key={row.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
          >
            <span className="font-display text-xs uppercase tracking-widest text-muted-foreground">{row.platform}</span>
            <span className="flex-1 truncate">{row.label ?? "—"}</span>
            <button
              type="button"
              onClick={() => remove(row.id)}
              className="text-xs uppercase tracking-wide text-muted-foreground underline-offset-2 hover:underline"
            >
              Remove
            </button>
          </li>
        ))}
        {(connections ?? []).length === 0 && (
          <li className="text-sm text-muted-foreground">No leagues synced yet.</li>
        )}
      </ul>
    </section>
  );
}
