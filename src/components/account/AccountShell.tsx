import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const itemClass =
  "block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-foreground/80 transition-colors hover:bg-muted";
const activeClass = "bg-muted text-foreground";

/** Shared 25/75 split layout for every /account route. */
export function AccountShell({
  title,
  active,
  action,
  children,
}: {
  title: string;
  active: "settings" | "leagues";
  action?: ReactNode;
  children: ReactNode;
}) {
  const { user, ready, signOut } = useAuth();

  const navigate = useNavigate();

  if (ready && !user) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-16">
        <h1 className="display-title text-3xl">Account</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in from the profile menu to manage your account.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <div className="grid gap-6 md:grid-cols-4">
        <nav aria-label="Account sections" className="md:col-span-1">
          <div className="rounded-xl border border-border bg-card p-2">
            <Link to="/account" className={cn(itemClass, active === "settings" && activeClass)}>
              Account Settings
            </Link>
            <Link
              to="/account/leagues"
              className={cn(itemClass, active === "leagues" && activeClass)}
            >
              My Leagues
            </Link>
            <div className="my-2 border-t border-border" />
            <button
              type="button"
              className={itemClass}
              onClick={async () => {
                await signOut();
                navigate({ to: "/" });
              }}
            >
              Sign Out
            </button>

          </div>
        </nav>

        <section className="md:col-span-3">
          <header className="mb-5">
            <h1 className="display-title text-3xl uppercase tracking-wide">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{user?.email}</p>
          </header>
          {children}
        </section>
      </div>
    </main>
  );
}
