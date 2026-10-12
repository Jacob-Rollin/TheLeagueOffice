import { useEffect, useState } from "react";

/**
 * Full-screen branded splash when the mobile PWA loses connectivity mid-session.
 * Cold starts with no network use /m/offline.html via the service worker instead.
 */
export function MobileOfflineSplash() {
  const [offline, setOffline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine === false : false,
  );

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

  if (!offline) return null;

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
      aria-label="No connection"
    >
      <img
        src="/m/icons/the-league-logo.png"
        alt="The League Office"
        className="m-offline-mark w-[min(58vw,220px)] drop-shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
      />
      <div className="absolute inset-x-0 bottom-0 px-6 pb-[max(1.75rem,env(safe-area-inset-bottom,0px))] text-center text-white">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/80">
          No connection
        </p>
        <p className="mt-1.5 text-base font-extrabold tracking-wide">
          Trying again when you’re back online
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-full bg-white/20 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white active:bg-white/30"
        >
          Retry
        </button>
      </div>
      <style>{`
        .m-offline-mark {
          animation: m-offline-breathe 1.8s ease-in-out infinite;
          will-change: transform, opacity;
        }
        @keyframes m-offline-breathe {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.06); opacity: 0.88; }
        }
        @media (prefers-reduced-motion: reduce) {
          .m-offline-mark { animation: none; }
        }
      `}</style>
    </div>
  );
}
