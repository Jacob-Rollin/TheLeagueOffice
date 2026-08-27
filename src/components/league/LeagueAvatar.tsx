import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type LeagueAvatarProps = {
  platform?: string | null | undefined;
  src?: string | null | undefined;
  alt?: string | undefined;
  /** Applied to the outer circle container. */
  className?: string | undefined;
};

/** Official slanted crimson ESPN "E" mark — real vector path geometry. */
function EspnMark() {
  return (
    <svg
      viewBox="0 0 64 32"
      className="h-8 w-8 -translate-x-[2px] object-contain"
      aria-hidden="true"
      role="img"
    >
      <path
        fill="#D50A0A"
        d="M54.8 9.2H27.9l-1 4.4h25.1l-1.1 5.1H25.8l-.9 4.1h26.9l-1.2 5.3H18.4l3.8-24.2h32.6zM14.1 5.1l-3.8 24.2H4.5L8.3 5.1h5.8z"
      />
    </svg>
  );
}

/** Official deep-purple Yahoo "Y!" mark — real vector path geometry. */
function YahooMark() {
  return (
    <svg viewBox="0 0 64 32" className="h-8 w-8 object-contain" aria-hidden="true" role="img">
      <path
        fill="#5F01D1"
        d="M20.1 5.1h6.4l5 9.3 5-9.3h6.4l-8.4 15.2v9.4h-6.1v-9.4L20.1 5.1z"
      />
      <path fill="#5F01D1" d="M47.9 14.2h4.9l-2.6 15.5h-4.8l2.5-15.5z" />
      <circle cx="49.6" cy="6.6" r="3" fill="#5F01D1" />
    </svg>
  );
}

export function LeagueAvatar({ platform, src, alt = "", className }: LeagueAvatarProps) {
  const [failed, setFailed] = useState(false);
  const url = typeof src === "string" && src.length > 0 ? src : null;
  const key = (platform ?? "").toLowerCase();

  useEffect(() => {
    setFailed(false);
  }, [url]);

  const shell = cn(
    "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-neutral-200 bg-white",
    className,
  );

  if (!url || failed) {
    return (
      <span className={shell}>
        {key === "espn" ? (
          <EspnMark />
        ) : key === "yahoo" ? (
          <YahooMark />
        ) : (
          <svg viewBox="0 0 24 24" className="h-6 w-6 object-contain text-neutral-400" fill="currentColor" aria-hidden="true">
            <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z" />
          </svg>
        )}
      </span>
    );
  }

  return (
    <span className={shell}>
      <img src={url} alt={alt} className="size-full object-cover" onError={() => setFailed(true)} />
    </span>
  );
}
