import { cn } from "@/lib/utils";

export type TlonCrawlItem = {
  id: string;
  text: string;
  kind: "injury" | "news";
};

export function TlonCrawl({ items }: { items: TlonCrawlItem[] }) {
  if (!items.length) {
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
        No injury or news hits for players in this matchup yet.
      </div>
    );
  }

  // Duplicate for a seamless CSS marquee loop.
  const loop = [...items, ...items];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-zinc-950 shadow-sm">
      <div className="flex items-stretch">
        <div className="flex shrink-0 items-center bg-rose-600 px-3 py-2">
          <span className="display-title text-xs tracking-widest text-white">Wire</span>
        </div>
        <div className="relative min-w-0 flex-1 overflow-hidden py-2">
          <div className="tlon-crawl-track flex w-max gap-8 whitespace-nowrap px-4">
            {loop.map((item, i) => (
              <span
                key={`${item.id}-${i}`}
                className={cn(
                  "inline-flex items-center gap-2 text-sm text-white/90",
                )}
              >
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                    item.kind === "injury" ? "bg-amber-500 text-zinc-950" : "bg-white/15 text-white",
                  )}
                >
                  {item.kind === "injury" ? "INJ" : "NEWS"}
                </span>
                {item.text}
              </span>
            ))}
          </div>
        </div>
      </div>
      <style>{`
        @keyframes tlon-crawl {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .tlon-crawl-track {
          animation: tlon-crawl 48s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .tlon-crawl-track { animation: none; }
        }
      `}</style>
    </div>
  );
}
