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
  "flex items-center justify-center rounded-2xl px-8 py-14 font-display text-3xl font-bold uppercase tracking-wide text-white transition-transform hover:-translate-y-0.5";
const inputClass =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-black outline-none focus:border-ring";
const labelClass = "block text-xs font-semibold uppercase tracking-wide text-black";
const buttonClass =
  "rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-60";

function LeagueSyncPage() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [platform, setPlatform] = useState<Platform | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [identifier, setIdentifier] = useState("");
  const [espnS2, setEspnS2] = useState("");
  const [espnSwid, setEspnSwid] = useState("");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!platform) return;
    if (!userId) {
      setStatus("Sign in to sync a league.");
      return;
    }
    const label = identifier.trim();
    if (!label) {
      setStatus("Enter a league identifier first.");
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
      espn_s2: platform === "espn" ? espnS2.trim() || null : null,
      espn_swid: platform === "espn" ? espnSwid.trim() || null : null,
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
    <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-10">
      <h1 className="display-title text-3xl text-foreground">Sync A League</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick the platform that hosts your league to start the import.
      </p>

      <div className="mt-8 grid gap-5 sm:grid-cols-2">
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
          className={`${cardClass} sm:col-span-2`}
          style={{ backgroundColor: "#0f1e36" }}
        >
          Sleeper
        </button>
      </div>

      {platform && (
        <form onSubmit={save} className="mt-8 max-w-md space-y-3 rounded-xl border border-border bg-card p-6">
          <label className={labelClass}>
            {platform === "sleeper"
              ? "Sleeper User Or League ID"
              : platform === "espn"
                ? "ESPN League ID"
                : "Yahoo League Key"}
            <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} className={inputClass} />
          </label>

          {platform === "espn" && (
            <>
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

          <button type="submit" disabled={busy} className={buttonClass}>
            {busy ? "Saving…" : "Save Connection"}
          </button>
          {status && <p className="text-sm text-muted-foreground">{status}</p>}
        </form>
      )}
    </main>
  );
}
