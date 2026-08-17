import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";

import { cn } from "@/lib/utils";
import { getPlayerNews } from "@/lib/players.functions";

function timeAgo(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.max(1, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function PlayerNews({ id }: { id: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["player-news", id],
    queryFn: () => getPlayerNews({ data: { id } }),
    staleTime: 1000 * 60 * 10,
  });

  return (
    <div className="space-y-4 px-3 pt-4">
      <div
        className={cn(
          "rounded-lg border p-3",
          data?.injury.status
            ? "border-destructive/60 bg-destructive/10"
            : "border-border bg-card",
        )}
      >
        <div className="font-display text-xs uppercase tracking-widest text-muted-foreground">
          Injury status
        </div>
        <div
          className={cn(
            "font-display text-lg uppercase",
            data?.injury.status ? "text-destructive" : "text-primary",
          )}
        >
          {data?.injury.status ?? "Healthy — no designation"}
        </div>
        {data?.injury.note && (
          <p className="mt-1 text-xs text-muted-foreground">{data.injury.note}</p>
        )}
      </div>

      {isLoading && (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          Loading latest news…
        </p>
      )}
      {isError && (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          News feed unavailable right now.
        </p>
      )}

      <ul className="space-y-2">
        {(data?.items ?? []).map((n) => (
          <li key={n.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center gap-2">
              {n.aboutPlayer ? (
                <span className="rounded bg-primary/20 px-1.5 py-0.5 font-display text-[10px] uppercase tracking-wide text-primary">
                  Player
                </span>
              ) : (
                <span className="rounded bg-secondary px-1.5 py-0.5 font-display text-[10px] uppercase tracking-wide text-muted-foreground">
                  League
                </span>
              )}
              <span className="tabnum text-[11px] text-muted-foreground">
                {timeAgo(n.published)}
              </span>
            </div>
            <h3 className="mt-1 text-sm font-semibold leading-snug">{n.headline}</h3>
            {n.description && (
              <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{n.description}</p>
            )}
            {n.link && (
              <a
                href={n.link}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-primary"
              >
                Read on ESPN <ExternalLink className="size-3" />
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
