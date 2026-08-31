import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";

import { usePlayerBrain } from "@/hooks/usePlayerBrain";
import { cn } from "@/lib/utils";
import { getPlayerNews } from "@/lib/players.functions";

/** Format the raw FantasyCalc 7-day trend into a market percentage move. */
function formatTrendPct(raw: number): string {
  const pct = raw / 100;
  if (pct > 0) return `▲ ${pct.toFixed(1)}%`;
  if (pct < 0) return `▼ ${Math.abs(pct).toFixed(1)}%`;
  return "0.0%";
}

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

type Tag = {
  label: string;
  class: string;
};

const INJURY_KEYWORDS = [
  "injury",
  "injured",
  "hurt",
  "pain",
  "out",
  "doubtful",
  "questionable",
  "probable",
  "ir",
  "surgery",
  "recover",
  "rehab",
  "hamstring",
  "ankle",
  "knee",
  "concussion",
  "groin",
  "calf",
  "shoulder",
  "back",
  "quadricep",
  "quad",
  "thumb",
  "wrist",
  "foot",
  "toe",
  "ribs",
  "illness",
  "dnr",
  "did not",
  "limited",
  "full participant",
  "practice",
];

function classify(headline: string, description: string, aboutPlayer: boolean): Tag {
  const text = `${headline} ${description}`.toLowerCase();
  const isInjury = INJURY_KEYWORDS.some((k) => text.includes(k));

  if (isInjury) {
    return {
      label: "INJURY ALERT",
      class: "bg-destructive/15 text-destructive border-destructive/30",
    };
  }

  if (aboutPlayer) {
    return {
      label: "TRENDING",
      class: "bg-primary/15 text-primary border-primary/30",
    };
  }

  return {
    label: "SCOUTING",
    class: "bg-secondary text-muted-foreground border-border",
  };
}

export function PlayerNews({ id, pos }: { id: string; pos?: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["player-news", id],
    queryFn: () => getPlayerNews({ data: { id } }),
    staleTime: 1000 * 60 * 10,
  });
  const brain = usePlayerBrain();
  const brainEntry = brain?.[id] ?? null;
  const trend = brainEntry?.trend ?? 0;

  return (
    <div className="space-y-4 px-3 pt-4">
      {pos !== "DEF" && (
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
        {data?.injury.status && trend < 0 && (
          <p className="mt-1 text-xs text-black">
            · MARKET IMPACT: Trade market value has dropped {formatTrendPct(trend)} over the
            last 7 days due to injury risk.
          </p>
        )}
        {data?.injury.status && trend > 0 && (
          <p className="mt-1 text-xs text-black">
            · MARKET IMPACT: Trade market value has risen {formatTrendPct(trend)} over the
            last 7 days despite the injury designation.
          </p>
        )}
        {brainEntry?.injuryNotes && (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {brainEntry.injuryNotes}
          </p>
        )}
      </div>
      )}

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

      <ul className="space-y-3">
        {(data?.items ?? []).map((n) => {
          const tag = classify(n.headline, n.description, n.aboutPlayer);
          return (
            <li
              key={n.id}
              className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "inline-flex rounded border px-1.5 py-0.5 font-display text-[10px] font-bold uppercase tracking-wide",
                    tag.class,
                  )}
                >
                  {tag.label}
                </span>
                <span className="tabnum shrink-0 text-[11px] text-muted-foreground">
                  {timeAgo(n.published)}
                </span>
              </div>
              <h3 className="text-sm font-semibold leading-snug">{n.headline}</h3>
              {n.description && (
                <p className="line-clamp-3 text-xs text-muted-foreground">{n.description}</p>
              )}
              {n.link && (
                <a
                  href={n.link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-primary"
                >
                  Read on ESPN <ExternalLink className="size-3" />
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
