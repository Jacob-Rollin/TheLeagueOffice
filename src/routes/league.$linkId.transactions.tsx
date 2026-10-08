import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/league/$linkId/transactions")({
  ssr: false,
  component: NativeTransactionsStub,
});

function NativeTransactionsStub() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="display-title text-2xl text-slate-900">
        League <span className="text-primary">Transactions</span>
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        Adds, drops, waivers, and trades will log here. Free-agent moves come next after My Team.
      </p>
    </section>
  );
}
