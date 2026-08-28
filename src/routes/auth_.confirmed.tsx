import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { AuthDialog } from "@/components/auth/AuthDialog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth_/confirmed")({
  head: () => ({
    meta: [
      { title: "Email Confirmed — The League Office" },
      { name: "description", content: "Your League Office email address is confirmed and your account is active." },
      { property: "og:title", content: "Email Confirmed — The League Office" },
      { property: "og:description", content: "Your roster handle is now active." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ConfirmedPage,
});

function ConfirmedPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [seconds, setSeconds] = useState(5);
  const [authOpen, setAuthOpen] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const handled = useRef(false);

  // Intercept the Yahoo OAuth return leg and persist the synced league.
  useEffect(() => {
    if (handled.current || !userId) return;
    const params = new URLSearchParams(window.location.search);
    const sync = params.get("sync");
    if (!sync) return;
    handled.current = true;

    if (sync !== "yahoo") {
      setSyncNote(params.get("reason") ?? "League sync could not be completed.");
      return;
    }

    const leagueKey = params.get("league_key");
    const label = params.get("label") ?? leagueKey ?? "Yahoo League";
    if (!leagueKey) {
      setSyncNote("Yahoo did not return a league.");
      return;
    }

    void (async () => {
      const { error } = await supabase.from("synced_leagues").insert({
        user_id: userId,
        platform: "yahoo",
        league_id: leagueKey,
        metadata: { label },
      });

      if (error) {
        setSyncNote(error.message);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["league-connections", userId] });
      queryClient.invalidateQueries({ queryKey: ["active-league-connections", userId] });
      setSyncNote(`${label} synced from Yahoo.`);
    })();
  }, [userId, queryClient]);

  useEffect(() => {
    if (authOpen) return;
    if (seconds <= 0) {
      navigate({ to: "/" });
      return;
    }
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds, authOpen, navigate]);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col items-center px-4 py-20 text-center">
      <CheckCircle2 className="size-16 text-emerald-500" aria-hidden />
      <h1 className="display-title mt-6 text-3xl uppercase tracking-wide">Email Successfully Confirmed</h1>
      <p className="mt-2 text-sm text-muted-foreground">Your roster handle is now active.</p>
      {syncNote && <p className="mt-2 text-sm text-black">{syncNote}</p>}


      <div className="mt-8 w-full rounded-xl border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          Redirecting to the homepage in <span className="font-semibold text-foreground">{seconds}</span>{" "}
          {seconds === 1 ? "second" : "seconds"}…
        </p>
        <button
          type="button"
          onClick={() => setAuthOpen(true)}
          className="mt-4 w-full rounded-md bg-primary px-4 py-2 font-display text-sm uppercase tracking-wide text-primary-foreground"
        >
          Sign In Now
        </button>
      </div>

      <AuthDialog open={authOpen} mode="signin" onOpenChange={setAuthOpen} />
    </main>
  );
}
