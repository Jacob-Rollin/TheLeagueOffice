import { createFileRoute, notFound } from "@tanstack/react-router";

import { PlayerDetail, detailQuery } from "@/components/draft/PlayerDetail";

export const Route = createFileRoute("/player/$id")({
  head: () => ({
    meta: [
      { title: "Player profile — The League Office" },
      {
        name: "description",
        content:
          "Player profile with prior-season stats, current projections, team depth chart, strength of schedule and injury risk.",
      },
      { property: "og:title", content: "Player profile — The League Office" },
      {
        property: "og:description",
        content:
          "Prior-season production, projections, depth chart, schedule difficulty and injury risk for every draftable player.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(detailQuery(params.id));
    if (!data) throw notFound();
  },
  component: PlayerPage,
});

function PlayerPage() {
  const { id } = Route.useParams();
  return (
    <main className="mx-auto w-full max-w-3xl pb-16">
      <PlayerDetail id={id} />
    </main>
  );
}
