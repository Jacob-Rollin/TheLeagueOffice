import { createFileRoute } from "@tanstack/react-router";

import { ProjectionAnalyticsDashboard } from "@/components/projection-analytics/ProjectionAnalyticsDashboard";
import { useAuth } from "@/hooks/useAuth";
import { adminGateStatus, useIsAdmin } from "@/hooks/useIsAdmin";

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
  const { data: isAdmin, isFetched, isError, refetch, isFetching } = useIsAdmin(
    user?.id ?? null,
  );
  const gate = adminGateStatus({
    ready,
    userId: user?.id,
    isAdmin,
    isFetched,
    isError,
  });

  if (gate === "loading") {
    return <Notice text="Loading Authorization..." />;
  }
  if (gate === "verify_failed") {
    return (
      <Notice
        text="Could not verify admin access. You are signed in — retry in a moment."
        actionLabel={isFetching ? "Retrying…" : "Retry"}
        actionDisabled={isFetching}
        onAction={() => void refetch()}
      />
    );
  }
  if (gate !== "allowed") {
    return <Notice text="Unauthorized Access — Admin Privileges Required." tone="error" />;
  }
  return <ProjectionAnalyticsDashboard />;
}

function Notice({
  text,
  tone,
  actionLabel,
  actionDisabled,
  onAction,
}: {
  text: string;
  tone?: "error";
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
}) {
  return (
    <main className="mx-auto w-full max-w-shell px-3 pb-16 pt-6">
      <div
        className={
          tone === "error"
            ? "border border-slate-200 bg-white p-6 font-display text-sm uppercase tracking-wide text-destructive"
            : "border border-slate-200 bg-white p-6 font-display text-sm uppercase tracking-wide text-muted-foreground"
        }
      >
        <p>{text}</p>
        {actionLabel && onAction ? (
          <button
            type="button"
            disabled={actionDisabled}
            onClick={onAction}
            className="mt-3 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium normal-case tracking-normal text-foreground disabled:opacity-60"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </main>
  );
}
