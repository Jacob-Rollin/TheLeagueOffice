import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/leaguesync")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sync A League — The League Office" },
      {
        name: "description",
        content: "Connect your Yahoo, ESPN or Sleeper fantasy football league to The League Office.",
      },
      { property: "og:title", content: "Sync A League — The League Office" },
      { property: "og:description", content: "Choose your fantasy platform and sync your league." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LeagueSyncPage,
});

type Platform = "yahoo" | "espn" | "sleeper";

const cardClass =
  "flex flex-1 items-center justify-center rounded-2xl px-6 py-12 font-display text-2xl font-bold uppercase tracking-wide text-white transition-transform hover:-translate-y-0.5";
const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-black placeholder:text-black/50 outline-none focus:border-ring";
const blueButton =
  "rounded-md px-6 py-2 font-display text-sm uppercase tracking-wide text-white disabled:opacity-60";

function LeagueSyncPage() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [platform, setPlatform] = useState<Platform>("sleeper");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState("");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) {
      setStatus("Sign in to sync a league.");
      return;
    }
    const label = identifier.trim();
    if (!label) {
      setStatus("Enter your username first.");
      return;
    }
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.from("league_connections").insert({
      user_id: userId,
      platform,
      label,
      sleeper_user_id: platform === "sleeper" ? label : null,
      espn_league_id: platform === "espn" ? label : null,
      yahoo_league_key: platform === "yahoo" ? label : null,
    });
    setBusy(false);
    if (error) {
      setStatus(error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["league-connections", userId] });
    queryClient.invalidateQueries({ queryKey: ["active-league-connections", userId] });
    navigate({ to: "/account/leagues" });
  };

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-20 pt-10">
      <h1 className="display-title text-3xl text-foreground">Sync A League</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick the platform that hosts your league to start the import.
      </p>

      <div className="mt-8 flex flex-row gap-5">
        <button
          type="button"
          onClick={() => setPlatform("yahoo")}
          className={cardClass}
          style={{ backgroundColor: "#6001d2" }}
        >
          Yahoo
        </button>
        <button
          type="button"
          onClick={() => setPlatform("espn")}
          className={cardClass}
          style={{ backgroundColor: "#cc0000" }}
        >
          ESPN
        </button>
        <button
          type="button"
          onClick={() => setPlatform("sleeper")}
          className={cardClass}
          style={{ backgroundColor: "#0f1e36" }}
        >
          Sleeper
        </button>
      </div>

      <section className="mt-10 rounded-2xl border border-border bg-card p-8">
        {platform === "sleeper" && (
          <div className="mx-auto flex max-w-md flex-col items-center text-center">
            <h2 className="font-display text-2xl font-bold text-foreground">Connect with Sleeper</h2>
            <p className="mt-1 text-sm text-muted-foreground">Please enter your Sleeper username</p>
            <div
              className="mt-6 flex w-40 items-center justify-center rounded-xl py-6 font-display text-lg font-bold text-white"
              style={{ backgroundColor: "#0f1e36" }}
            >
              Sleeper
            </div>
            <form onSubmit={save} className="mt-6 w-full space-y-3">
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="Username"
                className={inputClass}
              />
              <button
                type="submit"
                disabled={busy}
                className={blueButton}
                style={{ backgroundColor: "#0077ff" }}
              >
                {busy ? "Saving…" : "Continue"}
              </button>
            </form>
            {status && <p className="mt-3 text-sm text-muted-foreground">{status}</p>}
            <p className="mt-6 text-xs text-muted-foreground">
              (The email address associated with your Sleeper account will not work)
            </p>
          </div>
        )}

        {platform === "espn" && (
          <div className="mx-auto flex max-w-md flex-col items-center text-center">
            <h2 className="font-display text-2xl font-bold text-foreground">Connect with ESPN</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Next, you'll be redirected to ESPN to finish syncing your league(s).
            </p>
            <div
              className="mt-6 flex w-40 items-center justify-center rounded-xl py-6 font-display text-lg font-bold text-white"
              style={{ backgroundColor: "#cc0000" }}
            >
              ESPN
            </div>
            <button type="button" className={`${blueButton} mt-6`} style={{ backgroundColor: "#0077ff" }}>
              Install Now
            </button>
            <p className="mt-6 text-xs text-muted-foreground">
              Once you have the extension installed, please refresh this page to complete your league
              sync.
            </p>
            <a href="/faq" className="mt-4 text-xs text-foreground underline">
              Have questions? Read our FAQ to learn more.
            </a>
          </div>
        )}

        {platform === "yahoo" && (
          <div className="mx-auto flex max-w-md flex-col items-center text-center">
            <h2 className="font-display text-2xl font-bold text-foreground">Connect with Yahoo</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Please authorize access to your Yahoo sports profile.
            </p>
            <p className="mt-6 font-display text-3xl font-bold" style={{ color: "#6001d2" }}>
              yahoo! fantasy
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Fantasy data provided by Yahoo Fantasy
            </p>
            <button type="button" className={`${blueButton} mt-6`} style={{ backgroundColor: "#0077ff" }}>
              Continue
            </button>
            <p className="mt-6 text-xs text-muted-foreground">
              Note: You won't be able to connect if you used a third-party (like{" "}
              <span className="underline">Facebook</span>) to sign in.{" "}
              <span className="underline">Create a Yahoo account</span> first.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
