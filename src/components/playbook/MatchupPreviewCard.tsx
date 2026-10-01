import { useEffect, useState } from "react";

import { resolveAvatarUrl } from "@/components/playbook/panels";
import { cn } from "@/lib/utils";
function teamInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "TM";
  const letters = cleaned.replace(/[^a-zA-Z0-9]/g, "");
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

export function MatchupTeamAvatar({
  name,
  logo,
  platform,
  cacheKey,
  size = "md",
}: {
  name: string;
  logo?: string | null;
  platform?: string | null;
  cacheKey?: string | null;
  size?: "md" | "sm";
}) {
  const [failed, setFailed] = useState(false);
  const src = resolveAvatarUrl(logo);
  const plat = (platform ?? "").trim().toLowerCase();
  const remountKey = `${cacheKey ?? "matchup"}:${src ?? "none"}:${plat}`;
  const box = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const espnImg = size === "sm" ? "h-5 w-5" : "h-7 w-7";
  const initials = size === "sm" ? "text-[10px]" : "text-xs";

  useEffect(() => {
    setFailed(false);
  }, [src, cacheKey, plat]);

  if (src && !failed) {
    return (
      <span
        key={remountKey}
        className={cn(
          "flex shrink-0 overflow-hidden rounded-lg border border-slate-200/80 bg-slate-50",
          box,
        )}
      >
        <img
          key={remountKey}
          src={src}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  if (plat === "espn") {
    return (
      <span
        key={remountKey}
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200/80 bg-white p-1",
          box,
        )}
      >
        <img src="/espn.png" alt="ESPN" className={cn(espnImg, "object-contain")} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      key={remountKey}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg border border-slate-200/80 bg-slate-50 font-bold text-slate-600",
        box,
        initials,
      )}
    >
      {teamInitials(name)}
    </span>
  );
}

export function MatchupPreviewCard({
  loading,
  leagueId,
  platform,
  myName,
  myLogo,
  myRecord,
  myLive,
  myProj,
  myWinPct,
  oppName,
  oppLogo,
  oppRecord,
  oppLive,
  oppProj,
  oppWinPct,
  weekStarted = false,
  matchupFinal = false,
}: {
  loading: boolean;
  leagueId?: string | null;
  platform?: string | null;
  myName: string;
  myLogo?: string | null;
  myRecord?: string | null;
  myLive: number;
  /** Original weekly projection total (not live-collapsed). */
  myProj: number;
  /** Dynamic live win probability — same engine as the Matchup page (0–100). */
  myWinPct: number;
  oppName: string;
  oppLogo?: string | null;
  oppRecord?: string | null;
  oppLive: number;
  /** Original weekly projection total (not live-collapsed). */
  oppProj: number;
  /** Dynamic live win probability — same engine as the Matchup page (0–100). */
  oppWinPct: number;
  /** False before any NFL games kick off this week → proj stays grey. */
  weekStarted?: boolean;
  /** True when every starter game is final — show WON / LOST instead of %. */
  matchupFinal?: boolean;
}) {
  const mineWon = myLive > oppLive + 0.005;
  const oppWon = oppLive > myLive + 0.005;
  const matchupTied = matchupFinal && !mineWon && !oppWon;
  const mineLeadsWin = matchupFinal ? mineWon : myWinPct >= oppWinPct;

  const mineBarClass = matchupFinal
    ? mineWon
      ? "bg-emerald-500"
      : "bg-transparent"
    : mineLeadsWin
      ? "bg-emerald-500"
      : "bg-rose-500";
  const oppBarClass = matchupFinal
    ? oppWon
      ? "bg-emerald-500"
      : "bg-transparent"
    : mineLeadsWin
      ? "bg-rose-500"
      : "bg-emerald-500";
  const mineBarWidth = matchupFinal ? (mineWon ? 100 : matchupTied ? 50 : 0) : myWinPct;
  const oppBarWidth = matchupFinal ? (oppWon ? 100 : matchupTied ? 50 : 0) : oppWinPct;

  const mineLabel = matchupFinal
    ? matchupTied
      ? "TIE"
      : mineWon
        ? "WON"
        : "LOST"
    : `${myWinPct}%`;
  const oppLabel = matchupFinal
    ? matchupTied
      ? "TIE"
      : oppWon
        ? "WON"
        : "LOST"
    : `${oppWinPct}%`;
  const minePctClass = matchupFinal
    ? matchupTied
      ? "text-slate-500"
      : mineWon
        ? "text-emerald-600"
        : "text-rose-600"
    : mineLeadsWin
      ? "text-emerald-600"
      : "text-rose-600";
  const oppPctClass = matchupFinal
    ? matchupTied
      ? "text-slate-500"
      : oppWon
        ? "text-emerald-600"
        : "text-rose-600"
    : mineLeadsWin
      ? "text-rose-600"
      : "text-emerald-600";
  const avatarLeagueKey = leagueId ?? "none";

  const projTone = (live: number, proj: number) => {
    if (!weekStarted) return "text-slate-400";
    if (Math.abs(live - proj) < 0.005) return "text-slate-400";
    if (live > proj + 0.005) return "text-emerald-600";
    if (live < proj - 0.005) return "text-rose-600";
    return "text-slate-400";
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading matchup preview…</p>;
  }

  return (
    <div key={avatarLeagueKey} className="rounded-xl border border-blue-100 bg-blue-50/40 pb-4">
      <div className="flex items-center gap-2 px-3 py-5 sm:gap-3 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
          <MatchupTeamAvatar
            name={myName}
            logo={myLogo ?? null}
            platform={platform ?? null}
            cacheKey={`${avatarLeagueKey}-mine`}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold leading-tight text-slate-900 sm:text-lg">
              {myName}
            </p>
            {myRecord ? (
              <p className="mt-0.5 text-xs font-medium tabular-nums text-slate-400">{myRecord}</p>
            ) : null}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-2xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-3xl">
              {myLive.toFixed(2)}
            </p>
            <p className={cn("mt-1 text-xs font-medium tabular-nums", projTone(myLive, myProj))}>
              {myProj.toFixed(2)}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-1.5 px-0.5 sm:px-1">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-extrabold uppercase text-white">
            vs
          </span>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
          <div className="shrink-0 text-left">
            <p className="text-2xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-3xl">
              {oppLive.toFixed(2)}
            </p>
            <p className={cn("mt-1 text-xs font-medium tabular-nums", projTone(oppLive, oppProj))}>
              {oppProj.toFixed(2)}
            </p>
          </div>
          <div className="min-w-0 flex-1 text-right">
            <p className="truncate text-base font-bold leading-tight text-slate-900 sm:text-lg">
              {oppName}
            </p>
            {oppRecord ? (
              <p className="mt-0.5 text-xs font-medium tabular-nums text-slate-400">{oppRecord}</p>
            ) : null}
          </div>
          <MatchupTeamAvatar
            name={oppName}
            logo={oppLogo ?? null}
            platform={platform ?? null}
            cacheKey={`${avatarLeagueKey}-opp`}
          />
        </div>
      </div>

      <div className="mt-4 flex w-full items-center gap-3 px-3 text-xs font-bold uppercase tracking-wide sm:px-4">
        <span className={cn("w-12 shrink-0", minePctClass)}>{mineLabel}</span>
        <div className="flex h-1.5 min-w-0 flex-1 items-center gap-1.5">
          <div className="flex h-full min-w-0 flex-1 justify-end overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn("h-full rounded-full transition-[width] duration-500", mineBarClass)}
              style={{ width: `${mineBarWidth}%` }}
            />
          </div>
          <div className="flex h-full min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn("h-full rounded-full transition-[width] duration-500", oppBarClass)}
              style={{ width: `${oppBarWidth}%` }}
            />
          </div>
        </div>
        <span className={cn("w-12 shrink-0 text-right", oppPctClass)}>{oppLabel}</span>
      </div>
    </div>
  );
}
