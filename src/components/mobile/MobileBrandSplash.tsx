import { useEffect, useState } from "react";

export type MobileBrandSplashMode = "boot" | "offline";

const LOGO_SRC = "/m/icons/the-league-logo.png";

/**
 * Branded full-screen splash for mobile /m:
 * - boot: logo only while the shell preloads (no connection copy)
 * - offline: same mark + no-connection messaging / retry
 */
export function MobileBrandSplash({
  mode,
  onRetry,
}: {
  mode: MobileBrandSplashMode;
  onRetry?: () => void;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const offline = mode === "offline";

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center px-6"
      style={{
        background: "#1ba3c6",
        paddingTop: "max(1.5rem, env(safe-area-inset-top, 0px))",
        paddingBottom: "max(2rem, env(safe-area-inset-bottom, 0px))",
      }}
      role="status"
      aria-live="polite"
      aria-label={offline ? "No connection" : "Loading The League Office"}
      aria-busy={!offline}
    >
      {logoFailed ? (
        <p className="m-brand-mark max-w-xs text-center text-[1.35rem] font-extrabold uppercase tracking-wide text-white drop-shadow-[0_6px_20px_rgba(0,0,0,0.18)]">
          The League Office
        </p>
      ) : (
        <img
          src={LOGO_SRC}
          alt="The League Office"
          className="m-brand-mark w-[min(58vw,220px)] drop-shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
          onError={() => setLogoFailed(true)}
        />
      )}

      {offline ? (
        <div className="absolute inset-x-0 bottom-0 px-6 pb-[max(1.75rem,env(safe-area-inset-bottom,0px))] text-center text-white">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/80">
            No connection
          </p>
          <p className="mt-1.5 text-base font-extrabold tracking-wide">
            Trying again when you’re back online
          </p>
          <button
            type="button"
            onClick={() => (onRetry ? onRetry() : window.location.reload())}
            className="mt-4 rounded-full bg-white/20 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white active:bg-white/30"
          >
            Retry
          </button>
        </div>
      ) : null}

      <style>{`
        .m-brand-mark {
          animation: m-brand-breathe 1.8s ease-in-out infinite;
          will-change: transform, opacity;
        }
        @keyframes m-brand-breathe {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.06); opacity: 0.88; }
        }
        @media (prefers-reduced-motion: reduce) {
          .m-brand-mark { animation: none; }
        }
      `}</style>
    </div>
  );
}

const BOOT_MIN_MS = 700;
const BOOT_MAX_MS = 4000;

/**
 * Boot splash (online, logo only) + offline splash (connection copy).
 * Boot covers cold open / hard refresh of /m until auth+admin gate resolves.
 */
export function MobileSplashHost({ gateLoading }: { gateLoading: boolean }) {
  const [offline, setOffline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine === false : false,
  );
  const [minElapsed, setMinElapsed] = useState(false);
  const [bootDone, setBootDone] = useState(false);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    setOffline(navigator.onLine === false);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  useEffect(() => {
    const minTimer = window.setTimeout(() => setMinElapsed(true), BOOT_MIN_MS);
    const maxTimer = window.setTimeout(() => setBootDone(true), BOOT_MAX_MS);
    return () => {
      window.clearTimeout(minTimer);
      window.clearTimeout(maxTimer);
    };
  }, []);

  useEffect(() => {
    if (!gateLoading && minElapsed) setBootDone(true);
  }, [gateLoading, minElapsed]);

  if (offline) {
    return <MobileBrandSplash mode="offline" />;
  }
  if (!bootDone) {
    return <MobileBrandSplash mode="boot" />;
  }
  return null;
}
