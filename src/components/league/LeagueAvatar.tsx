import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type LeagueAvatarProps = {
  platform?: string | null | undefined;
  src?: string | null | undefined;
  alt?: string | undefined;
  /** Applied to the outer circle container. */
  className?: string | undefined;
};

const FALLBACK_SHELL =
  "bg-white border border-neutral-200 w-10 h-10 rounded-full flex items-center justify-center p-1.5 overflow-hidden";

export function LeagueAvatar({ platform, src, alt = "", className }: LeagueAvatarProps) {
  const [failed, setFailed] = useState(false);
  const url = typeof src === "string" && src.length > 0 ? src : null;
  const key = (platform ?? "").toLowerCase();

  useEffect(() => {
    setFailed(false);
  }, [url]);

  const imageShell = cn(
    "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-neutral-200 bg-white",
    className,
  );

  if (!url || failed) {
    return (
      <span className={cn(FALLBACK_SHELL, className)}>
        {key === "espn" ? (
          <svg
            viewBox="0 0 24 24"
            className="w-7 h-7 transform -translate-x-[0.5px]"
            fill="#CC0000"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path d="M23.111 6.133h-14.73l.363-1.6h14.73l-.363 1.6zm-.816 3.6H4.218l.363-1.6h18.077l-.363 1.6zm-1.18 5.2H1.28l.363-1.6h19.836l-.364 1.6zm.363-1.6h-5.26l.363-1.6h5.261l-.364 1.6zm-.726 3.2h-5.262l.363-1.6h5.262l-.363 1.6zm-12.015 0H.889l.363-1.6h7.848l-.363 1.6z" />
          </svg>
        ) : key === "yahoo" ? (
          <svg
            viewBox="0 0 24 24"
            className="w-6 h-6"
            fill="#6001D2"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path d="M12.923 11.625l5.525-8.225h-3.66l-3.61 5.795-3.627-5.795H3.846l5.518 8.197v5.54h3.56v-5.517zm7.391 2.502c-1.042 0-1.89.845-1.89 1.892 0 1.042.848 1.889 1.89 1.889 1.043 0 1.892-.847 1.892-1.889 0-1.047-.849-1.892-1.892-1.892zm-1.636-5.83h3.272v6.623h-3.272V8.297z" />
          </svg>
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
