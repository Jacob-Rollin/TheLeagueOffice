import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { ChevronLeft, House, Monitor, Settings } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import { AuthDialog, type AuthMode } from "@/components/auth/AuthDialog";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { cn } from "@/lib/utils";

import { MobilePlayerSheetProvider } from "./MobilePlayerSheet";
import { MobileSettingsOverlay } from "./MobileSettings";
import { MobileThemeProvider, useMobileTheme } from "./MobileThemeContext";

const iconButtonClass =
  "inline-flex size-11 items-center justify-center rounded-lg bg-m-icon-bg text-m-icon-fg transition-opacity hover:opacity-85";

/** Themed wrapper for every /m page: header, theme tokens, and the admin-only gate. */
export function MobileShell({ children }: { children: ReactNode }) {
  return (
    <MobileThemeProvider>
      <MobileFrame>{children}</MobileFrame>
    </MobileThemeProvider>
  );
}

function MobileFrame({ children }: { children: ReactNode }) {
  const { theme } = useMobileTheme();
  const { user, ready } = useAuth();
  const { data: isAdmin, isFetched, isError } = useIsAdmin(user?.id ?? null);

  const checking = !ready || (Boolean(user) && !isFetched);
  const signedIn = Boolean(user);
  const allowed = signedIn && !isError && isAdmin === true;

  return (
    <div
      className={cn(
        theme === "dark" ? "mobile-theme-dark" : "mobile-theme-light",
        "min-h-screen bg-m-bg font-sans text-m-card-fg",
      )}
    >
      <div className="mx-auto w-full max-w-md">
        <MobileHeader />
        {checking ? (
          <MobileNotice>Checking access...</MobileNotice>
        ) : allowed ? (
          <MobilePlayerSheetProvider>{children}</MobilePlayerSheetProvider>
        ) : !signedIn ? (
          <MobileSignInGate />
        ) : (
          <MobileNotice>Admin access required. Mobile pages are in preview.</MobileNotice>
        )}
      </div>
    </div>
  );
}

const SUBPAGE_TITLES: Record<string, string> = { waivers: "Waivers", trades: "Trades" };

function MobileHeader() {
  const { theme } = useMobileTheme();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const inLeague = pathname.startsWith("/m/league/");
  const [, , , leagueId, subpage] = pathname.replace(/\/+$/, "").split("/");
  const subpageTitle = inLeague && subpage ? SUBPAGE_TITLES[subpage] : undefined;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const settingsButton = (
    <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Settings" className={iconButtonClass}>
      <Settings className="size-5" strokeWidth={2.5} />
    </button>
  );
  const headerClass = cn(
    "sticky top-0 z-20 flex items-center justify-between bg-m-header px-4 pb-3 text-m-header-fg",
    theme === "dark" ? "border-b border-m-border" : "shadow-[0_2px_6px_rgba(0,0,0,0.18)]",
  );
  // With viewport-fit=cover, clear the iPhone notch / status bar.
  const headerStyle = { paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))" } as const;

  if (subpageTitle && leagueId) {
    return (
      <header className={headerClass} style={headerStyle}>
        <button
          type="button"
          aria-label="Back"
          className={iconButtonClass}
          onClick={() =>
            router.history.canGoBack()
              ? router.history.back()
              : void router.navigate({ to: "/m/league/$leagueId/team", params: { leagueId } })
          }
        >
          <ChevronLeft className="size-6" strokeWidth={2.5} />
        </button>
        <h1
          className="absolute left-1/2 -translate-x-1/2 font-display text-xl font-semibold tracking-wide"
          style={{ top: "calc((100% + env(safe-area-inset-top, 0px)) / 2)", transform: "translate(-50%, -50%)" }}
        >
          {subpageTitle}
        </h1>
        <span className="size-11" aria-hidden="true" />
      </header>
    );
  }

  return (
    <>
      {settingsOpen ? <MobileSettingsOverlay onClose={closeSettings} /> : null}
      <header className={headerClass} style={headerStyle}>
        {inLeague ? (
          <Link to="/m" aria-label="Home" className={iconButtonClass}>
            <House className="size-5" strokeWidth={2.5} />
          </Link>
        ) : (
          settingsButton
        )}

        <Link
          to="/m"
          aria-label="The League Office home"
          className="absolute left-1/2 -translate-x-1/2"
          style={{ top: "calc((100% + env(safe-area-inset-top, 0px)) / 2)", transform: "translate(-50%, -50%)" }}
        >
          <img src="/the-league-logo.png" alt="" className="h-12 w-auto" />
        </Link>

        {inLeague ? (
          settingsButton
        ) : (
          <Link to="/" aria-label="Open desktop site" className={iconButtonClass}>
            <Monitor className="size-5" strokeWidth={2.5} />
          </Link>
        )}
      </header>
    </>
  );
}

function MobileNotice({ children }: { children: ReactNode }) {
  return (
    <div className="px-5 py-16 text-center font-display text-sm font-semibold uppercase tracking-widest text-m-muted">
      {children}
    </div>
  );
}

/** Signed-out home: same auth dialog as desktop, mobile-sized CTAs. */
function MobileSignInGate() {
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("signin");

  const openAuth = (mode: AuthMode) => {
    setAuthMode(mode);
    setAuthOpen(true);
  };

  return (
    <main className="px-5 pb-10 pt-10">
      <div className="mx-auto flex max-w-sm flex-col items-center text-center">
        <img src="/the-league-logo.png" alt="" className="h-16 w-auto" />
        <h1 className="mt-6 font-display text-[28px] font-bold leading-tight tracking-wide text-m-card-fg">
          Sign in to continue
        </h1>
        <p className="mt-2 text-sm text-m-muted">
          Use your League Office account to open the mobile league experience.
        </p>
        <button
          type="button"
          onClick={() => openAuth("signin")}
          className={
            "mt-8 w-full rounded-lg bg-m-cta px-4 py-3.5 font-display text-lg font-extrabold italic " +
            "uppercase tracking-wider text-m-cta-fg shadow-[0_3px_0_rgba(0,0,0,0.25)] " +
            "transition-transform active:translate-y-px"
          }
        >
          Sign In
        </button>
        <button
          type="button"
          onClick={() => openAuth("signup")}
          className={
            "mt-3 w-full rounded-lg bg-m-chip px-4 py-3.5 font-display text-lg font-semibold " +
            "tracking-wide text-m-chip-fg transition-opacity hover:opacity-90"
          }
        >
          Create Account
        </button>
        <Link
          to="/"
          className="mt-6 text-sm font-semibold text-m-accent underline-offset-2 hover:underline"
        >
          Open desktop site
        </Link>
      </div>
      <AuthDialog open={authOpen} mode={authMode} onOpenChange={setAuthOpen} />
    </main>
  );
}

export function MobileSectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="px-5 pb-3 pt-7 font-display text-lg font-bold uppercase tracking-[0.08em] text-m-section">
      {children}
    </h2>
  );
}

export function MobileCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        "mx-4 overflow-hidden rounded-xl bg-m-card text-m-card-fg shadow-[0_2px_4px_rgba(0,0,0,0.12)]",
        className,
      )}
    >
      {children}
    </section>
  );
}
