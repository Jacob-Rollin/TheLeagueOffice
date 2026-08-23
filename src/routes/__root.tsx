import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, Link, createRootRouteWithContext, useRouter, HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { ScoreTicker } from "@/components/league/ScoreTicker";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import {
  ActiveOperationsMenu,
  FrontOfficeMenu,
  ProfileMenu,
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
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
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
      { name: "viewport", content: "width=device-width, initial-scale=1" },
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
        href: "https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Barlow+Condensed:wght@500;600;700;800&display=swap",
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
      <nav className="mx-auto flex w-full max-w-6xl items-center gap-2 px-3 py-1.5">
        <Link to="/" className="display-title mr-2 whitespace-nowrap text-lg">
          THE LEAGUE <span className="text-accent-foreground/90 rounded bg-accent px-1.5">OFFICE</span>
        </Link>

        {/* Left-side navigation grouping */}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          <Link to="/" activeOptions={{ exact: true }} className={navLinkClass}>
            League HQ
          </Link>
          <FrontOfficeMenu />
          <ActiveOperationsMenu />
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
  return (
    <QueryClientProvider client={queryClient}>
      <ScoreTicker />
      <SiteNav />
      <Outlet />
    </QueryClientProvider>
  );
}
