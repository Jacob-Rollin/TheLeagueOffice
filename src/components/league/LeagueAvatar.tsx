import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type LeagueAvatarProps = {
  platform?: string | null | undefined;
  src?: string | null | undefined;
  alt?: string | undefined;
  /** Applied to the outer circle container. */
  className?: string | undefined;
};

/** Official slanted crimson ESPN "E" mark. */
function EspnMark() {
  return (
    <svg viewBox="0 0 64 32" className="h-6 w-6 object-contain" aria-hidden="true">
      <text
        x="32"
        y="24"
        textAnchor="middle"
        fontFamily="Helvetica, Arial, sans-serif"
        fontSize="26"
        fontWeight="900"
        fontStyle="italic"
        fill="#D50A0A"
      >
        E
      </text>
    </svg>
  );
}

/** Official deep-purple Yahoo "Y!" mark. */
function YahooMark() {
  return (
    <svg viewBox="0 0 64 32" className="h-6 w-6 object-contain" aria-hidden="true">
      <text
        x="32"
        y="24"
        textAnchor="middle"
        fontFamily="Helvetica, Arial, sans-serif"
        fontSize="24"
        fontWeight="800"
        fill="#5F01D1"
      >
        Y!
      </text>
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
