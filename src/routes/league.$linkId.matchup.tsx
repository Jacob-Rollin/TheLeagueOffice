import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/league/$linkId/matchup")({
  ssr: false,
  component: NativeMatchupStub,
});

function NativeMatchupStub() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="display-title text-2xl text-slate-900">
        Week <span className="text-primary">Matchup</span>
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        H2H boards land after scoring cron writes weekly results. Schedule pairings already show on
        the Dashboard.
      </p>
    </section>
  );
}
