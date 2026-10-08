import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

import { COMMISH_SCROLL_PAD } from "./commissioner/MobileCommissionerChrome";
import { MobileCommissionerTools } from "./commissioner/MobileCommissionerTools";
import { useMobileTheme, type MobileThemePreference } from "./MobileThemeContext";

const THEME_OPTIONS: { value: MobileThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match Device" },
];

const outlineButton =
  "rounded-lg border border-m-border px-4 py-2 font-display text-base font-semibold tracking-wide text-m-card-fg";

/** Full-screen Settings panel layered over the current mobile page. */
export function MobileSettingsOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      className="fixed inset-0 z-[60] max-w-[100vw] overflow-x-clip overflow-y-auto overscroll-x-none bg-m-bg touch-pan-y"
    >
      <div
        className="mx-auto w-full max-w-md overflow-x-clip"
        style={{ paddingBottom: COMMISH_SCROLL_PAD }}
      >
        <header className="sticky top-0 z-10 flex items-center justify-center border-b border-m-border bg-m-header px-4 py-3 text-m-header-fg">
          <h1 className="font-display text-xl font-semibold tracking-wide">Settings</h1>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="absolute right-4 inline-flex size-11 items-center justify-center rounded-lg bg-m-icon-bg text-m-icon-fg transition-opacity hover:opacity-85"
          >
            <X className="size-5" strokeWidth={2.5} />
          </button>
        </header>
        <MobileSettingsContent onNavigate={onClose} />
      </div>
    </div>
  );
}

function SettingsCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl bg-m-card px-4 pb-4 pt-4 text-m-card-fg">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold uppercase tracking-[0.08em]">{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function MobileSettingsContent({ onNavigate }: { onNavigate: () => void }) {
  const { preference, setPreference } = useMobileTheme();
  const { user, signOut } = useAuth();
  const { activeLeague } = useActiveLeague();
  const navigate = useNavigate();
  const [commishOpen, setCommishOpen] = useState(false);
  const current = THEME_OPTIONS.find((o) => o.value === preference) ?? THEME_OPTIONS[0]!;

  return (
    <>
      {commishOpen ? <MobileCommissionerTools onClose={() => setCommishOpen(false)} /> : null}
      <main className="space-y-3 px-2.5 py-3">
        <SettingsCard
          title="Account"
          action={
            <button
              type="button"
              className={outlineButton}
              onClick={async () => {
                await signOut();
                onNavigate();
                void navigate({ to: "/" });
              }}
            >
              Log Out
            </button>
          }
        >
          <Link to="/account" onClick={onNavigate} className="flex items-center justify-between gap-3 py-1">
            <span className="truncate text-base">{user?.email ?? "Signed in"}</span>
            <ChevronRight className="size-5 shrink-0" />
          </Link>
        </SettingsCard>

        {activeLeague ? (
          <SettingsCard title="League">
            <p className="mb-2 truncate text-sm text-m-muted">{activeLeague.name}</p>
            <button
              type="button"
              onClick={() => setCommishOpen(true)}
              className="flex w-full items-center justify-between gap-3 py-1 text-left"
            >
              <span className="text-base">Commissioner Tools</span>
              <ChevronRight className="size-5 shrink-0" />
            </button>
          </SettingsCard>
        ) : null}

        <SettingsCard title="App Settings">
          <div className="flex items-center justify-between gap-4">
            <span className="text-base">Theme</span>
            <label
              className={cn(
                outlineButton,
                "relative flex w-48 items-center justify-between font-sans text-base font-normal",
              )}
            >
              {current.label}
              <ChevronDown className="size-5" />
              <select
                aria-label="Theme"
                value={preference}
                onChange={(e) => setPreference(e.target.value as MobileThemePreference)}
                className="absolute inset-0 cursor-pointer opacity-0"
              >
                {THEME_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </SettingsCard>
      </main>
    </>
  );
}
