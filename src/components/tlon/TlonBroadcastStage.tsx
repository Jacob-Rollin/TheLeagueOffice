import { Maximize2, Minimize2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { TlonCrawl, type TlonCrawlItem } from "@/components/tlon/TlonCrawl";
import { TlonField } from "@/components/tlon/TlonField";
import { TlonScorebug, type TlonDaypart } from "@/components/tlon/TlonScorebug";
import { TlonScoringUpdateToast } from "@/components/tlon/TlonScoringUpdate";
import type { TlonPlayArc, TlonScoringUpdate } from "@/lib/tlon-play-feed";
import { cn } from "@/lib/utils";

function clearBodyLock() {
  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";
}

function lockBodyScroll() {
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
}

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
  /** CSS / iOS fallback fullscreen (Safari often blocks Element.requestFullscreen). */
  const [cssFullscreen, setCssFullscreen] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const fullscreen = cssFullscreen || nativeFullscreen;

  useEffect(() => {
    const onChange = () => {
      const active = document.fullscreenElement === stageRef.current;
      setNativeFullscreen(active);
      if (active) {
        setCssFullscreen(false);
        clearBodyLock();
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!cssFullscreen) return;
    lockBodyScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCssFullscreen(false);
        clearBodyLock();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearBodyLock();
    };
  }, [cssFullscreen]);

  const exitFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        /* ignore */
      }
    }
    setNativeFullscreen(false);
    setCssFullscreen(false);
    clearBodyLock();
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = stageRef.current;
    if (!el) return;

    if (fullscreen) {
      await exitFullscreen();
      return;
    }

    // Prefer native Fullscreen API when the browser actually supports it.
    const req =
      el.requestFullscreen?.bind(el) ??
      (
        el as HTMLElement & {
          webkitRequestFullscreen?: () => Promise<void> | void;
        }
      ).webkitRequestFullscreen?.bind(el);

    const enabled =
      typeof document !== "undefined" &&
      (document.fullscreenEnabled ||
        Boolean(
          (document as Document & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled,
        ));

    if (req && enabled) {
      try {
        await Promise.resolve(req());
        setNativeFullscreen(true);
        return;
      } catch {
        /* fall through to CSS fullscreen — expected on iOS Safari */
      }
    }

    // iOS Safari: fixed overlay that fills the visual viewport.
    setCssFullscreen(true);
    lockBodyScroll();
  }, [exitFullscreen, fullscreen]);

  return (
    <div
      ref={stageRef}
      className={cn(
        "relative overflow-hidden rounded-2xl border border-slate-800 bg-zinc-950 shadow-2xl",
        cssFullscreen &&
          "fixed inset-0 z-[200] flex h-[100dvh] max-h-[100dvh] w-screen flex-col rounded-none border-0",
        nativeFullscreen && "flex h-full min-h-full flex-col rounded-none border-0",
      )}
    >
      <div className={cn("relative min-h-0", fullscreen && "flex min-h-0 flex-1 flex-col")}>
        <div className={cn(fullscreen && "min-h-0 flex-1")}>
          <TlonField
            arc={arc}
            fillHeight={fullscreen}
            {...(onArcDone ? { onArcDone } : {})}
          />
        </div>

        {/* Scorebug overlay — lower third */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-1.5 pb-1.5 sm:px-4 sm:pb-3">
          <div className="pointer-events-auto">
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
          className="absolute left-2 top-2 z-30 flex min-h-9 items-center gap-1.5 rounded-lg border border-white/25 bg-black/65 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm transition-colors active:bg-black/80"
          aria-label={fullscreen ? "Exit fullscreen" : "Watch fullscreen"}
        >
          {fullscreen ? <Minimize2 className="size-3.5 shrink-0" /> : <Maximize2 className="size-3.5 shrink-0" />}
          <span>{fullscreen ? "Exit" : "Full"}</span>
        </button>
      </div>

      <div className="shrink-0 border-t border-white/10">
        <TlonCrawl items={crawlItems} embedded />
      </div>

      {channelRail ? (
        <div className="shrink-0 border-t border-white/10 bg-zinc-950/95 px-2 py-2">{channelRail}</div>
      ) : null}
    </div>
  );
}
