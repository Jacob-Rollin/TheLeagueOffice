import { Maximize2, Minimize2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { TlonCrawl, type TlonCrawlItem } from "@/components/tlon/TlonCrawl";
import { TlonField } from "@/components/tlon/TlonField";
import { TlonScorebug, type TlonDaypart } from "@/components/tlon/TlonScorebug";
import { TlonScoringUpdateToast } from "@/components/tlon/TlonScoringUpdate";
import type { TlonPlayArc, TlonScoringUpdate } from "@/lib/tlon-play-feed";
import { cn } from "@/lib/utils";

export function TlonBroadcastStage({
  week,
  daypart,
  leftName,
  leftLogo,
  leftRecord,
  leftLive,
  leftYetToPlay,
  leftYetToPlayMax,
  rightName,
  rightLogo,
  rightRecord,
  rightLive,
  rightYetToPlay,
  rightYetToPlayMax,
  winPctLeft,
  winPctRight,
  platform,
  leagueKey,
  leadingSide,
  scorePulseSide,
  arc,
  onArcDone,
  scoringUpdate,
  onScoringUpdateDone,
  onSelectScoringMatchup,
  crawlItems,
  channelRail,
}: {
  week: number;
  daypart: TlonDaypart;
  leftName: string;
  leftLogo?: string | null;
  leftRecord?: string | null;
  leftLive: number;
  leftYetToPlay: number;
  leftYetToPlayMax: number;
  rightName: string;
  rightLogo?: string | null;
  rightRecord?: string | null;
  rightLive: number;
  rightYetToPlay: number;
  rightYetToPlayMax: number;
  winPctLeft: number;
  winPctRight: number;
  platform?: string | null;
  leagueKey?: string | null;
  leadingSide: "left" | "right" | "tie";
  scorePulseSide?: "left" | "right" | null;
  arc: TlonPlayArc | null;
  onArcDone?: (id: string) => void;
  scoringUpdate: TlonScoringUpdate | null;
  onScoringUpdateDone?: () => void;
  onSelectScoringMatchup?: (matchupId: string) => void;
  crawlItems: TlonCrawlItem[];
  channelRail?: ReactNode;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => {
      setFullscreen(document.fullscreenElement === stageRef.current);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = stageRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen();
      } else if (el.requestFullscreen) {
        await el.requestFullscreen();
      }
    } catch {
      /* iOS / blocked — ignore */
    }
  }, []);

  return (
    <div
      ref={stageRef}
      className={cn(
        "relative overflow-hidden rounded-2xl border border-slate-800 bg-zinc-950 shadow-2xl",
        fullscreen && "flex h-full min-h-screen flex-col rounded-none border-0",
      )}
    >
      <div className={cn("relative", fullscreen && "flex-1")}>
        <TlonField arc={arc} {...(onArcDone ? { onArcDone } : {})} />

        {/* Scorebug overlay — lower third */}
        <div className="absolute inset-x-0 bottom-0 z-20 px-2 pb-2 sm:px-4 sm:pb-3">
          <TlonScorebug
            week={week}
            daypart={daypart}
            leftName={leftName}
            leftLogo={leftLogo ?? null}
            leftRecord={leftRecord ?? null}
            leftLive={leftLive}
            leftYetToPlay={leftYetToPlay}
            leftYetToPlayMax={leftYetToPlayMax}
            rightName={rightName}
            rightLogo={rightLogo ?? null}
            rightRecord={rightRecord ?? null}
            rightLive={rightLive}
            rightYetToPlay={rightYetToPlay}
            rightYetToPlayMax={rightYetToPlayMax}
            winPctLeft={winPctLeft}
            winPctRight={winPctRight}
            platform={platform ?? null}
            leagueKey={leagueKey ?? null}
            leadingSide={leadingSide}
            scorePulseSide={scorePulseSide ?? null}
          />
        </div>

        <TlonScoringUpdateToast
          update={scoringUpdate}
          platform={platform ?? null}
          leagueKey={leagueKey ?? null}
          {...(onSelectScoringMatchup ? { onSelect: onSelectScoringMatchup } : {})}
          {...(onScoringUpdateDone ? { onDone: onScoringUpdateDone } : {})}
        />

        <button
          type="button"
          onClick={() => void toggleFullscreen()}
          className="absolute left-2 top-2 z-30 flex items-center gap-1.5 rounded-lg border border-white/20 bg-black/55 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm transition-colors hover:bg-black/75"
          aria-label={fullscreen ? "Exit fullscreen" : "Watch fullscreen"}
        >
          {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          <span className="hidden sm:inline">{fullscreen ? "Exit" : "Fullscreen"}</span>
        </button>
      </div>

      {/* Crawl flush under bug / field */}
      <div className="border-t border-white/10">
        <TlonCrawl items={crawlItems} embedded />
      </div>

      {channelRail ? <div className="border-t border-white/10 bg-zinc-950/95 px-2 py-2">{channelRail}</div> : null}
    </div>
  );
}
