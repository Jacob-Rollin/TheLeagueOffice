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
type EspnTab = "public" | "private";

const cardClass =
  "flex flex-1 items-center justify-center rounded-2xl px-6 py-12 font-display text-2xl font-bold uppercase tracking-wide text-white transition-transform hover:-translate-y-0.5";
const brandBlock =
  "mt-6 flex w-40 items-center justify-center rounded-xl py-6 font-display text-lg font-bold text-white";
const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-black placeholder:text-black/50 outline-none focus:border-ring";
const labelClass = "block text-left text-xs font-semibold uppercase tracking-wide text-black";
const blueButton =
  "rounded-md px-6 py-2 font-display text-sm uppercase tracking-wide text-white disabled:opacity-60";

function LeagueSyncPage() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const yahooUnconfigured =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("yahoo") === "unconfigured";

  const [platform, setPlatform] = useState<Platform>(yahooUnconfigured ? "yahoo" : "sleeper");
  const [espnTab, setEspnTab] = useState<EspnTab>("public");
  const [guideOpen, setGuideOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [identifier, setIdentifier] = useState("");
  const [espnLeagueId, setEspnLeagueId] = useState("");
  const [espnS2, setEspnS2] = useState("");
  const [espnSwid, setEspnSwid] = useState("");

  const saveConnection = async (
    next: Platform,
    label: string,
    extra: Record<string, string | null> = {},
  ) => {
    if (!userId) {
      setStatus("Sign in to sync a league.");
      return;
    }
    if (!label) {
      setStatus("Enter your league details first.");
      return;
    }
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.from("synced_leagues").insert({
      user_id: userId,
      platform: next,
      league_id: label,
      espn_s2: extra?.["espn_s2"] ?? null,
      swid: extra?.["espn_swid"] ?? null,
      metadata: { label, platform: next, teams: [], rules: {} },
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
            <h2 className="font-display text-2xl font-bold text-black">Connect with Sleeper</h2>
            <p className="mt-1 text-sm text-muted-foreground">Please enter your Sleeper username</p>
            <div className={brandBlock} style={{ backgroundColor: "#0f1e36" }}>
              Sleeper
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveConnection("sleeper", identifier.trim());
              }}
              className="mt-6 w-full space-y-3"
            >
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
            <h2 className="font-display text-2xl font-bold text-black">Connect with ESPN</h2>
            <div className={brandBlock} style={{ backgroundColor: "#cc0000" }}>
              ESPN
            </div>

            <div className="mt-6 flex w-full border-b border-border">
              <button
                type="button"
                onClick={() => setEspnTab("public")}
                className={`flex-1 px-4 py-2 text-sm ${
                  espnTab === "public"
                    ? "border-b-2 border-primary font-semibold text-black"
                    : "text-muted-foreground"
                }`}
              >
                Public League
              </button>
              <button
                type="button"
                onClick={() => setEspnTab("private")}
                className={`flex-1 px-4 py-2 text-sm ${
                  espnTab === "private"
                    ? "border-b-2 border-primary font-semibold text-black"
                    : "text-muted-foreground"
                }`}
              >
                Private League
              </button>
            </div>

            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              className="mt-4 self-start text-xs text-black underline"
            >
              How do I find these keys?
            </button>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveConnection(
                  "espn",
                  espnLeagueId.trim(),
                  espnTab === "private"
                    ? { espn_s2: espnS2.trim() || null, espn_swid: espnSwid.trim() || null }
                    : {},
                );
              }}
              className="mt-4 w-full space-y-4 text-left"
            >
              <div className="space-y-1">
                <label className={labelClass} htmlFor="espn-league-id">
                  League ID
                </label>
                <input
                  id="espn-league-id"
                  value={espnLeagueId}
                  onChange={(e) => setEspnLeagueId(e.target.value)}
                  className={inputClass}
                />
              </div>

              {espnTab === "private" && (
                <>
                  <div className="space-y-1">
                    <label className={labelClass} htmlFor="espn-s2">
                      espn_s2 Cookie Key
                    </label>
                    <input
                      id="espn-s2"
                      value={espnS2}
                      onChange={(e) => setEspnS2(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={labelClass} htmlFor="espn-swid">
                      SWID Cookie Key
                    </label>
                    <input
                      id="espn-swid"
                      value={espnSwid}
                      onChange={(e) => setEspnSwid(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </>
              )}

              <button
                type="submit"
                disabled={busy}
                className={blueButton}
                style={{ backgroundColor: "#0077ff" }}
              >
                {espnTab === "public" ? "Sync Public League" : "Sync Private League"}
              </button>
            </form>
            {status && <p className="mt-3 text-sm text-muted-foreground">{status}</p>}
          </div>
        )}

        {platform === "yahoo" && (
          <div className="mx-auto flex max-w-md flex-col items-center text-center">
            <h2 className="font-display text-2xl font-bold text-black">Connect with Yahoo</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Please authorize access to your Yahoo sports profile.
            </p>
            <div className={brandBlock} style={{ backgroundColor: "#6001d2" }}>
              Yahoo
            </div>
            <button
              type="button"
              onClick={() => {
                window.location.href = "/api/auth/yahoo/connect";
              }}
              className={`${blueButton} mt-6`}
              style={{ backgroundColor: "#0077ff" }}
            >
              Continue
            </button>
            {yahooUnconfigured && (
              <p className="mt-4 text-xs text-black">
                Yahoo sync isn't available yet — the Yahoo app credentials still need to be added.
              </p>
            )}
            <p className="mt-6 text-xs text-muted-foreground">
              Note: You won't be able to connect if you used a third-party (like{" "}
              <span className="underline">Facebook</span>) to sign in.{" "}
              <span className="underline">Create a Yahoo account</span> first.
            </p>
          </div>
        )}
      </section>

      {guideOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 text-left">
            <h3 className="font-display text-xl font-bold text-black">Finding your ESPN keys</h3>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-black">
              <li>Sign in to fantasy.espn.com in a desktop browser and open your league.</li>
              <li>Your League ID is the number in the address bar after leagueId=.</li>
              <li>Open developer tools with F12, then go to the Application tab.</li>
              <li>Under Storage, expand Cookies and select https://fantasy.espn.com.</li>
              <li>Copy the value of espn_s2 and the value of SWID, braces included.</li>
              <li>Paste both values into the fields on this page and sync.</li>
            </ol>
            <button
              type="button"
              onClick={() => setGuideOpen(false)}
              className="mt-6 rounded-md border border-border px-4 py-2 text-sm text-black"
            >
              Close Guide
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
