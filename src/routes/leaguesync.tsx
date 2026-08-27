import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/leaguesync")({
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

const cardClass =
  "flex items-center justify-center rounded-2xl px-8 py-14 font-display text-3xl font-bold uppercase tracking-wide text-white transition-transform hover:-translate-y-0.5";

function LeagueSyncPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-10">
      <h1 className="display-title text-3xl text-foreground">Sync A League</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick the platform that hosts your league to start the import.
      </p>

      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <Link
          to="/account/leagues"
          search={{ platform: "yahoo" }}
          className={cardClass}
          style={{ backgroundColor: "#6001d2" }}
        >
          Yahoo
        </Link>
        <Link
          to="/account/leagues"
          search={{ platform: "espn" }}
          className={cardClass}
          style={{ backgroundColor: "#cc0000" }}
        >
          ESPN
        </Link>
        <Link
          to="/account/leagues"
          search={{ platform: "sleeper" }}
          className={`${cardClass} sm:col-span-2`}
          style={{ backgroundColor: "#0f1e36" }}
        >
          Sleeper
        </Link>
      </div>
    </main>
  );
}
