import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronRight,
  CircleUserRound,
  LogOut,
  ShieldCheck,
  Trophy,
  type LucideIcon,
} from "lucide-react";

import { AccessGate } from "@/components/league/AccessGate";
import { PageTitle } from "@/components/PageTitle";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { cn } from "@/lib/utils";

const itemClass =
  "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-foreground/80 transition-colors hover:bg-muted";
const activeClass = "bg-primary/10 font-semibold text-primary hover:bg-primary/10";

function NavItemContent({
  icon: Icon,
  label,
  active,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
}) {
  return (
    <>
      <Icon
        className={cn(
          "size-5 shrink-0 stroke-[1.75]",
          active ? "text-primary" : "text-foreground/60 group-hover:text-foreground/80",
        )}
        aria-hidden="true"
      />
      <span className="flex-1">{label}</span>
      {active ? (
        <ChevronRight className="size-4 shrink-0 stroke-[2.5] text-primary" aria-hidden="true" />
      ) : null}
    </>
  );
}

/** Shared 25/75 split layout for every /account route. */
export function AccountShell({
  title,
  active,
  action,
  children,
}: {
  title: string;
  active: "settings" | "leagues" | "admin";
  action?: ReactNode;
  children: ReactNode;
}) {
  const { user, ready, signOut } = useAuth();
  const { data: isAdmin } = useIsAdmin(user?.id ?? null);
  const showAdmin = isAdmin === true;

  const navigate = useNavigate();

  if (ready && !user) {
    return (
      <main className="mx-auto w-full max-w-shell pb-8 pt-4">
        <AccessGate
          kind="guest"
          product="Account"
          headline="Manage leagues from your account"
          description="Create an account to sync Sleeper or ESPN leagues, switch active rosters, and unlock Front Office tools."
        />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-shell px-4 py-10">
      <div className="grid gap-6 md:grid-cols-4">
        <nav aria-label="Account sections" className="md:col-span-1">
          <div className="rounded-xl border border-border bg-card p-2">
            {showAdmin && (
              <Link
                to="/account/admin"
                aria-current={active === "admin" ? "page" : undefined}
                className={cn(itemClass, active === "admin" && activeClass)}
              >
                <NavItemContent icon={ShieldCheck} label="Admin" active={active === "admin"} />
              </Link>
            )}
            <Link
              to="/account"
              aria-current={active === "settings" ? "page" : undefined}
              className={cn(itemClass, active === "settings" && activeClass)}
            >
              <NavItemContent
                icon={CircleUserRound}
                label="Account Settings"
                active={active === "settings"}
              />
            </Link>
            <Link
              to="/account/leagues"
              aria-current={active === "leagues" ? "page" : undefined}
              className={cn(itemClass, active === "leagues" && activeClass)}
            >
              <NavItemContent icon={Trophy} label="My Leagues" active={active === "leagues"} />
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
              <NavItemContent icon={LogOut} label="Sign Out" />
            </button>
          </div>
        </nav>

        <section className="md:col-span-3">
          <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <PageTitle>{title}</PageTitle>
              <p className="mt-1 text-sm text-muted-foreground">{user?.email}</p>
            </div>
            {action}
          </header>

          {children}
        </section>
      </div>
    </main>
  );
}
