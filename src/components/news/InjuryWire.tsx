import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import type { InjuryWireItem } from "@/lib/players.server";
import { cn } from "@/lib/utils";

const STATUS_CHIP: Record<string, string> = {
  IR: "bg-red-50 text-red-600",
  OUT: "bg-red-50 text-red-600",
  SUSP: "bg-red-50 text-red-600",
  PUP: "bg-orange-50 text-orange-600",
  D: "bg-orange-50 text-orange-600",
  Q: "bg-amber-50 text-amber-700",
  NA: "bg-red-50 text-red-600",
  DNR: "bg-red-50 text-red-600",
  COV: "bg-red-50 text-red-600",
};

function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const mins = Math.max(1, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function Headshot({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  return (
    <span className="flex size-14 shrink-0 items-end justify-center overflow-hidden rounded-full bg-slate-100">
      {src && !failed ? (
        <img
          src={src}
          alt={name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="mb-auto mt-auto text-sm font-semibold text-slate-500">{initials}</span>
      )}
    </span>
  );
}

function CardShell({ item, children }: { item: InjuryWireItem; children: ReactNode }) {
  const className =
    "group block rounded-lg border border-border/70 bg-white p-3 transition-colors hover:border-blue-600/40";
  if (item.sleeperId) {
    return (
      <Link to="/player/$id" params={{ id: item.sleeperId }} className={className}>
        {children}
      </Link>
    );
  }
  if (item.link) {
    return (
      <a href={item.link} target="_blank" rel="noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return <div className={className}>{children}</div>;
}

export function InjuryWire({ limit = 5 }: { limit?: number }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["injury-wire", limit],
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    queryFn: async () => {
      const { getInjuryWire } = await import("@/lib/players.functions");
      return await getInjuryWire({ data: { limit } });
    },
  });

  return (
    <section className="rounded-xl border border-border/80 bg-card p-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Injury Report
        </p>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-600">Latest</span>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex gap-3 rounded-lg border border-border/70 bg-white p-3">
              <span className="size-14 shrink-0 animate-pulse rounded-full bg-slate-100" />
              <div className="flex-1 space-y-2 py-1">
                <div className="h-3 w-4/5 animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      ) : isError || !data?.length ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">No new injury reports right now.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((item) => (
            <CardShell key={item.id} item={item}>
              <div className="flex gap-3">
                <Headshot src={item.headshot} name={item.playerName} />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold leading-snug text-zinc-950 transition-colors group-hover:text-blue-600">
                    {item.headline}
                  </h3>
                  <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{item.body}</p>
                </div>
              </div>
              <div className="mt-2.5 flex items-center gap-1.5">
                <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                  Injury
                </span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                    STATUS_CHIP[item.statusShort] ?? "bg-blue-50 text-blue-600",
                  )}
                >
                  {item.statusShort}
                </span>
                <span className="text-[11px] text-muted-foreground">{timeAgo(item.published)}</span>
                <span className="ml-auto truncate text-[11px] text-muted-foreground">via {item.source}</span>
              </div>
            </CardShell>
          ))}
        </div>
      )}
    </section>
  );
}
