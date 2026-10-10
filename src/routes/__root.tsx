import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, Link, createRootRouteWithContext, useRouter, useRouterState, HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import appCss from "../styles.css?url";
import { hydratePlayerBrain } from "@/lib/playerBrainHydration";
import { scheduleIdleSnapPrefetch } from "@/lib/idle-snap-prefetch";
import { registerPlayerDetailQueryClient } from "@/lib/prefetch-player-detail";
import {
  hydrateResearchQueryCache,
  subscribeResearchQueryPersist,
} from "@/lib/research-query-persist";
import { ScoreTicker } from "@/components/league/ScoreTicker";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import { ActiveLeagueProvider } from "@/context/ActiveLeagueContext";
import { LeagueSyncBootstrap } from "@/hooks/useLeagueSync";

import {
  DraftMenu,
  PlaybookMenu,
  ProfileMenu,
  ResearchMenu,
  TradeMenu,
  WaiverMenu,
  navLinkClass,
} from "@/components/nav/NavMenus";

// Injected at build time by vite.config.ts (`define`). Falls back in dev.
declare const __BUILD_ID__: string | undefined;
const BUILD_ID = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

const absoluteAssetPath = (assetPath: string) => {
  if (/^https?:\/\//i.test(assetPath)) return assetPath;
  const rooted = assetPath.startsWith("/") ? assetPath : `/${assetPath.replace(/^\.\//, "")}`;
  // Cache-bust per deployment: SSR and client render the same string, so no hydration mismatch.
  return `${rooted}${rooted.includes("?") ? "&" : "?"}v=${BUILD_ID}`;
};

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">Something went wrong. Try refreshing or head back home.</p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Try again
          </button>
          <Link to="/" className="rounded-md border border-border px-4 py-2 text-sm">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      // viewport-fit=cover so env(safe-area-inset-*) works on iPhone PWA/Safari
      // (otherwise the home indicator sits on top of the mobile tab bar).
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "The League Office — Fantasy Football HQ" },
      {
        name: "description",
        content: "Fantasy football league HQ, War Room draft board, trade evaluator and waiver tools.",
      },
      { property: "og:title", content: "The League Office" },
      { property: "og:description", content: "Your fantasy football front office." },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: absoluteAssetPath(appCss) },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Barlow+Condensed:ital,wght@0,500;0,600;0,700;0,800;1,600;1,700;1,800&display=swap",
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});
function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
function SiteNav() {
  return (
    <header className="border-b-4 border-accent bg-primary text-primary-foreground">
      <nav className="mx-auto flex w-full max-w-shell items-center gap-2 px-3 py-1.5">
        <Link to="/" className="display-title mr-2 whitespace-nowrap text-lg">
          THE LEAGUE <span className="text-accent-foreground/90 rounded bg-accent px-1.5">OFFICE</span>
        </Link>

        {/* Left-side navigation grouping */}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          <PlaybookMenu />
          <TradeMenu />
          <WaiverMenu />
          <DraftMenu />
          <ResearchMenu />
          <Link to="/tlon" className={navLinkClass}>
            The League Network
          </Link>
          <Link to="/hof" className={navLinkClass}>
            Hall of Fame
          </Link>
        </div>

        {/* Far-right utilities: search expands leftward, profile stays pinned */}
        <div className="flex shrink-0 items-center gap-2">
          <GlobalSearch />
          <ProfileMenu />
        </div>
      </nav>
    </header>
  );
}
function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Silent background player-brain hydration once per session (30-min heartbeat inside).
  // Do not re-fire on every pathname change — that re-entered withFreshSos / getSosBoard.
  useEffect(() => {
    registerPlayerDetailQueryClient(queryClient);
    void hydratePlayerBrain();
  }, [queryClient]);

  // Restore last-good research / matchup RQ from IndexedDB, then persist updates.
  useEffect(() => {
    let cancelled = false;
    let unsub = () => {};
    void hydrateResearchQueryCache(queryClient).finally(() => {
      if (cancelled) return;
      unsub = subscribeResearchQueryPersist(queryClient);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [queryClient]);

  // Idle-warm hottest research/injury snaps into RQ (snap-cdn only — no Fluid/TiDB).
  useEffect(() => scheduleIdleSnapPrefetch(queryClient), [queryClient]);

  const isMobilePage = pathname === "/m" || pathname.startsWith("/m/");

  return (

    <QueryClientProvider client={queryClient}>
      <ActiveLeagueProvider>
        <LeagueSyncBootstrap />
        {isMobilePage ? null : (
          <>
            <ScoreTicker />
            <SiteNav />
          </>
        )}
        <Outlet />
      </ActiveLeagueProvider>
    </QueryClientProvider>
  );
}
