import { useEffect, useState } from "react";

import { resolveNativeTeamAvatarSrc } from "@/lib/native-team-logos";
import { cn } from "@/lib/utils";

type LeagueAvatarProps = {
  platform?: string | null | undefined;
  src?: string | null | undefined;
  alt?: string | undefined;
  /** Team name (or initial) — baked into native pool logos. */
  teamName?: string | null | undefined;
  /** Applied to the outer circle container. */
  className?: string | undefined;
};

const FALLBACK_SHELL =
  "max-w-10 max-h-10 w-10 h-10 rounded-full bg-white border border-neutral-200 flex items-center justify-center p-1.5 overflow-hidden";

export function LeagueAvatar({
  platform,
  src,
  alt = "",
  teamName,
  className,
}: LeagueAvatarProps) {
  const [failed, setFailed] = useState(false);
  // Prefer explicit teamName; only fall back to alt when it looks like a name
  // (avoid baking "T" from phrases like "team avatar").
  const initialSource =
    (teamName && teamName.trim()) ||
    (alt && !/\b(logo|avatar|team avatar)\b/i.test(alt) ? alt : null);
  const resolved =
    typeof src === "string" && src.length > 0
      ? resolveNativeTeamAvatarSrc(src, initialSource)
      : null;
  const url = resolved && resolved.length > 0 ? resolved : null;
  const key = (platform ?? "").toLowerCase();

  useEffect(() => {
    setFailed(false);
  }, [url]);

  const imageShell = cn(
    "flex size-10 max-h-10 max-w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-neutral-200 bg-white",
    className,
  );

  if (!url || failed) {
    return (
      <span className={cn(FALLBACK_SHELL, className)}>
        {key === "espn" ? (
          <img
            src="/espn.png"
            alt="ESPN"
            className="w-7 h-7 object-contain"
            aria-hidden="true"
          />
        ) : key === "yahoo" ? (
          <img
            src="/yahoo.png"
            alt="Yahoo"
            className="w-6 h-6 object-contain"
            aria-hidden="true"
          />
        ) : (
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6 object-contain text-neutral-400"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z" />
          </svg>
        )}
      </span>
    );
  }

  return (
    <span className={imageShell}>
      <img src={url} alt={alt} className="size-full object-cover" onError={() => setFailed(true)} />
    </span>
  );
}
