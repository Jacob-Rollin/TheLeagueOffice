import { Link, useRouterState } from "@tanstack/react-router";

import { navLinkClass } from "@/components/nav/NavMenus";
import { useAuth } from "@/hooks/useAuth";

/**
 * Top-nav entry into desktop Fantasy hub (left of GlobalSearch).
 * SiteNav hides this while search is open; expanded search uses an opaque field.
 */
export function FantasyNavLink() {
  const { user, ready } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = pathname === "/fantasy" || pathname.startsWith("/league/");

  if (!ready) return null;

  if (!user) {
    return (
      <Link
        to="/account/leagues"
        className={navLinkClass}
        data-status={active ? "active" : undefined}
      >
        Fantasy
      </Link>
    );
  }

  return (
    <Link
      to="/fantasy"
      preload="intent"
      className={navLinkClass}
      data-status={active ? "active" : undefined}
    >
      Fantasy
    </Link>
  );
}
