import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/league/$linkId/standings")({
  ssr: false,
  component: NativeStandingsStub,
});

function NativeStandingsStub() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="display-title text-2xl text-slate-900">
        League <span className="text-primary">Standings</span>
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        Standings snapshots will materialize from week results. This page is a placeholder until
        scoring ships.
      </p>
    </section>
  );
}
