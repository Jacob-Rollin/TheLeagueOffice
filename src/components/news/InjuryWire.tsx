import { useQuery } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";

import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import type { InjuryWireItem } from "@/lib/players.server";
import { cn } from "@/lib/utils";

const POPUP_ROSE = "bg-rose-600 text-white shadow-rose-600/10";
const POPUP_AMBER = "bg-amber-500 text-slate-950 shadow-amber-500/10";

/** Same designation text and colors as the player popup badge. */
const STATUS_BADGE: Record<string, { text: string; tone: string }> = {
  Q: { text: "Questionable", tone: POPUP_AMBER },
  D: { text: "Doubtful", tone: POPUP_ROSE },
  OUT: { text: "Out", tone: POPUP_ROSE },
  IR: { text: "Injured Reserve", tone: POPUP_ROSE },
  PUP: { text: "PUP", tone: POPUP_ROSE },
  SUSP: { text: "Suspended", tone: POPUP_ROSE },
  NA: { text: "Not Active", tone: POPUP_ROSE },
  DNR: { text: "Did Not Report", tone: POPUP_ROSE },
  COV: { text: "COVID-19", tone: POPUP_ROSE },
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

function CardShell({
  item,
  onOpenPlayer,
  children,
}: {
  item: InjuryWireItem;
  onOpenPlayer: (id: string) => void;
  children: ReactNode;
}) {
  const className =
    "group block w-full rounded-lg border border-border/70 bg-white p-3 text-left transition-colors hover:border-blue-600/40";
  const sleeperId = item.sleeperId;
  if (sleeperId) {
    return (
      <button type="button" onClick={() => onOpenPlayer(sleeperId)} className={className}>
        {children}
      </button>
    );
  }
  if (item.link) {
    return (
      <a href={item.link} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return <div className={className}>{children}</div>;
}

export function InjuryWire({ limit = 5 }: { limit?: number }) {
  const modalRef = useRef<PlayerModalHandle>(null);
  const openPlayer = (id: string) => modalRef.current?.open(id);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["injury-wire", limit],
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchInterval: (q) =>
      typeof document !== "undefined" && document.visibilityState !== "visible"
        ? false
        : 10 * 60 * 1000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const { fetchSnapInjuryWire } = await import("@/lib/snap-cdn");
      return await fetchSnapInjuryWire(limit);
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
            <CardShell key={item.id} item={item} onOpenPlayer={openPlayer}>
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
                <span
                  className={cn(
                    "inline-flex select-none items-center justify-center rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest shadow-sm",
                    STATUS_BADGE[item.statusShort]?.tone ?? POPUP_ROSE,
                  )}
                >
                  {STATUS_BADGE[item.statusShort]?.text ?? (item.status || item.statusShort)}
                </span>
                <span className="ml-auto truncate text-[11px] text-muted-foreground">
                  {[timeAgo(item.published), `via ${item.source}`].filter(Boolean).join(" · ")}
                </span>
              </div>
            </CardShell>
          ))}
        </div>
      )}
      <PlayerModalHost ref={modalRef} />
    </section>
  );
}
