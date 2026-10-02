import { createFileRoute } from "@tanstack/react-router";

import { ProjectionAnalyticsDashboard } from "@/components/projection-analytics/ProjectionAnalyticsDashboard";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";

export const Route = createFileRoute("/admin/projection-analytics")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Projection Analytics — The League Office" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProjectionAnalyticsPage,
});

function ProjectionAnalyticsPage() {
  const { user, ready } = useAuth();
  const { data: isAdmin, isFetched, isError } = useIsAdmin(user?.id ?? null);

  if (!ready || (user && !isFetched)) {
    return <Notice text="Loading Authorization..." />;
  }
  if (!user || isError || !isAdmin) {
    return <Notice text="Unauthorized Access — Admin Privileges Required." tone="error" />;
  }
  return <ProjectionAnalyticsDashboard />;
}

function Notice({ text, tone }: { text: string; tone?: "error" }) {
  return (
    <main className="mx-auto w-full max-w-shell px-3 pb-16 pt-6">
      <div
        className={
          tone === "error"
            ? "border border-slate-200 bg-white p-6 font-display text-sm uppercase tracking-wide text-destructive"
            : "border border-slate-200 bg-white p-6 font-display text-sm uppercase tracking-wide text-muted-foreground"
        }
      >
        {text}
      </div>
    </main>
  );
}
