import { Link } from "@tanstack/react-router";

const LOGO_SRC = "/the-league-logo.png";

/**
 * Single right-rail CTA under the Fantasy leagues box — logo + create/join only.
 * No ESPN-style “#1 fantasy football game” copy.
 */
export function FantasyJoinAnotherCard() {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-[#0b1f3a] px-4 py-5 text-white shadow-sm">
      <div className="flex flex-col items-center text-center">
        <img
          src={LOGO_SRC}
          alt="The League Office"
          className="h-12 w-auto object-contain"
          loading="lazy"
        />
        <h2 className="mt-3 font-display text-base font-bold uppercase tracking-[0.12em] text-white">
          Ready to join another league?
        </h2>
        <div className="mt-4 flex w-full flex-col gap-2">
          <Link
            to="/account/leagues/setup"
            className="inline-flex w-full items-center justify-center rounded-md border border-blue-500 bg-blue-600 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-white transition-colors hover:bg-blue-500"
          >
            Create a League
          </Link>
          <Link
            to="/account/leagues/join"
            className="inline-flex w-full items-center justify-center rounded-md border border-white/35 bg-transparent px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-white transition-colors hover:border-white hover:bg-white/10"
          >
            Join a League
          </Link>
        </div>
      </div>
    </section>
  );
}
