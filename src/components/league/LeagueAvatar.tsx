import { useState } from "react";

import { cn } from "@/lib/utils";

type LeagueAvatarProps = {
  platform: string;
  src: string | null | undefined;
  alt: string;
  className?: string;
};

export function LeagueAvatar({ platform, src, alt, className }: LeagueAvatarProps) {
  const [failed, setFailed] = useState(false);
  const showFallback = !src || failed;

  if (showFallback && platform === "espn") {
    return (
      <svg
        viewBox="0 0 24 24"
        className={cn("size-5 fill-current", className)}
        aria-hidden="true"
      >
        <text
          x="50%"
          y="55%"
          dominantBaseline="middle"
          textAnchor="middle"
          className="font-black italic text-[14px]"
          style={{ fill: "currentColor" }}
        >
          E
        </text>
      </svg>
    );
  }

  if (showFallback && platform === "yahoo") {
    return (
      <svg
        viewBox="0 0 24 24"
        className={cn("size-5 fill-current", className)}
        aria-hidden="true"
      >
        <text
          x="50%"
          y="55%"
          dominantBaseline="middle"
          textAnchor="middle"
          className="font-bold text-[12px]"
          style={{ fill: "currentColor" }}
        >
          Y!
        </text>
      </svg>
    );
  }

  return (
    <img
      src={src!}
      alt={alt}
      className={cn("size-full object-cover", className)}
      onError={() => setFailed(true)}
    />
  );
}
