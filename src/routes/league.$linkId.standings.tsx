import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { getNativeStandings } from "@/lib/native-league.functions";

export const Route = createFileRoute("/league/$linkId/standings")({
  ssr: false,
  component: NativeStandingsPage,
});

function NativeStandingsPage() {
  const { linkId } = Route.useParams();
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["native-standings", linkId],
    enabled: Boolean(user?.id && linkId),
    staleTime: 30_000,
    queryFn: () => getNativeStandings({ data: { linkId } }),
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="display-title text-2xl text-slate-900">
          League <span className="text-primary">Standings</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {data ? `Through week ${data.week}` : "Standings update after scoring cron runs."}
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading standings…</p>
      ) : (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-semibold">Rk</th>
                  <th className="px-3 py-2 font-semibold">Team</th>
                  <th className="px-3 py-2 font-semibold">W</th>
                  <th className="px-3 py-2 font-semibold">L</th>
                  <th className="px-3 py-2 font-semibold">T</th>
                  <th className="px-3 py-2 font-semibold">PF</th>
                  <th className="px-3 py-2 font-semibold">PA</th>
                </tr>
              </thead>
              <tbody>
                {(data?.standings ?? []).map((row) => (
                  <tr key={row.teamId} className="border-b border-slate-50">
                    <td className="px-3 py-2 text-slate-500">{row.rank}</td>
                    <td className="px-3 py-2 font-medium text-slate-900">{row.teamName}</td>
                    <td className="px-3 py-2">{row.wins}</td>
                    <td className="px-3 py-2">{row.losses}</td>
                    <td className="px-3 py-2">{row.ties}</td>
                    <td className="px-3 py-2">{row.pointsFor.toFixed(1)}</td>
                    <td className="px-3 py-2">{row.pointsAgainst.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
