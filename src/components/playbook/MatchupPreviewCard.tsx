import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

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
  // Always pass team name so native `pool:` logos bake the correct monogram.
  const src = resolveAvatarUrl(logo, { teamName: name });
  const plat = (platform ?? "").trim().toLowerCase();
  const remountKey = `${cacheKey ?? "matchup"}:${src ?? "none"}:${plat}:${name}`;
  const box = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const espnImg = size === "sm" ? "h-5 w-5" : "h-7 w-7";
  const initials = size === "sm" ? "text-[10px]" : "text-xs";

  useEffect(() => {
    setFailed(false);
  }, [src, cacheKey, plat, name]);

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

/** Side used by Around the League rows (Playbook + native dashboards). */
export type AroundLeagueSide = {
  id: number | string;
  name: string;
  logo?: string | null;
  live: number;
  proj: number;
  winPct: number;
};

export type AroundLeagueMatchupRowProps = {
  a: AroundLeagueSide;
  b: AroundLeagueSide;
  started: boolean;
  final: boolean;
  platform?: string | null;
  cacheKey: string;
  recordFor?: (id: number | string, name: string) => string | null;
  /** When set, wraps each team name/avatar as a Playbook roster scout link. */
  scoutRosterId?: boolean;
};

/**
 * Compact matchup row under “Around the League” — shared by Playbook + native dashboards.
 */
export function AroundLeagueMatchupRow({
  a,
  b,
  started,
  final,
  platform,
  cacheKey,
  recordFor,
  scoutRosterId = false,
}: AroundLeagueMatchupRowProps) {
  const aWon = final && a.live > b.live + 0.005;
  const bWon = final && b.live > a.live + 0.005;
  const tied = final && !aWon && !bWon;
  const aLeads = final ? aWon : a.winPct >= b.winPct;

  const projTone = (live: number, proj: number) => {
    if (!started || Math.abs(live - proj) < 0.005) return "text-slate-400";
    return live > proj ? "text-emerald-600" : "text-rose-600";
  };
  const scoreTone = (won: boolean) =>
    final && !won && !tied ? "text-slate-400" : "text-slate-900";
  const barWidth = (side: AroundLeagueSide, won: boolean) =>
    final ? (won ? 100 : tied ? 50 : 0) : side.winPct;
  const pctLabel = (side: AroundLeagueSide, won: boolean) =>
    final ? (tied ? "TIE" : won ? "WON" : "LOST") : `${side.winPct}%`;
  const pctTone = (leads: boolean) =>
    final && tied ? "text-slate-500" : leads ? "text-emerald-600" : "text-rose-600";

  const team = (side: AroundLeagueSide, mirrored: boolean) => {
    const record = recordFor?.(side.id, side.name) ?? null;
    const body = (
      <>
        <MatchupTeamAvatar
          name={side.name}
          logo={side.logo ?? null}
          platform={platform ?? null}
          cacheKey={`${cacheKey}-${side.id}`}
          size="sm"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-tight text-slate-900">
            {side.name}
          </span>
          {record ? (
            <span className="mt-0.5 block text-[11px] font-medium tabular-nums text-slate-400">
              {record}
            </span>
          ) : null}
        </span>
      </>
    );
    const shellClass = cn(
      "flex min-w-0 flex-1 items-center gap-2.5 transition-opacity hover:opacity-85",
      mirrored && "flex-row-reverse text-right",
    );
    if (scoutRosterId) {
      return (
        <Link
          to="/playbook/rosters"
          search={{ scout: String(side.id) }}
          className={shellClass}
        >
          {body}
        </Link>
      );
    }
    return <div className={shellClass}>{body}</div>;
  };

  const score = (side: AroundLeagueSide, won: boolean, mirrored: boolean) => (
    <div className={cn("w-16 shrink-0", mirrored ? "text-left" : "text-right")}>
      <p className={cn("text-lg font-bold tabular-nums leading-tight", scoreTone(won))}>
        {side.live.toFixed(2)}
      </p>
      <p className={cn("text-[11px] font-medium tabular-nums", projTone(side.live, side.proj))}>
        {side.proj.toFixed(2)}
      </p>
    </div>
  );

  return (
    <li className="py-3">
      <div className="flex items-center gap-2 sm:gap-3">
        {team(a, false)}
        {score(a, aWon, false)}
        <span className="w-6 shrink-0 text-center text-[10px] font-extrabold uppercase text-slate-300">
          vs
        </span>
        {score(b, bWon, true)}
        {team(b, true)}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide">
        <span className={cn("w-10 shrink-0", pctTone(aLeads))}>{pctLabel(a, aWon)}</span>
        <div className="flex h-1 min-w-0 flex-1 items-center gap-1">
          <div className="flex h-full min-w-0 flex-1 justify-end overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500",
                final ? (aWon ? "bg-emerald-500" : "bg-transparent") : aLeads ? "bg-emerald-500" : "bg-rose-500",
              )}
              style={{ width: `${barWidth(a, aWon)}%` }}
            />
          </div>
          <div className="flex h-full min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500",
                final ? (bWon ? "bg-emerald-500" : "bg-transparent") : aLeads ? "bg-rose-500" : "bg-emerald-500",
              )}
              style={{ width: `${barWidth(b, bWon)}%` }}
            />
          </div>
        </div>
        <span className={cn("w-10 shrink-0 text-right", pctTone(!aLeads))}>{pctLabel(b, bWon)}</span>
      </div>
    </li>
  );
}

/** Section wrapper matching Playbook dashboard Matchups panel chrome. */
export function MatchupsPanelShell({
  title = "Matchups",
  weekLabel,
  action,
  children,
  className,
}: {
  title?: string;
  weekLabel?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card p-4 sm:p-5",
        className,
      )}
    >
      <div
        className={cn(
          "mb-3 items-center gap-3 border-b border-slate-200 pb-3",
          weekLabel ? "grid grid-cols-[1fr_auto_1fr]" : "flex justify-between",
        )}
      >
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">{title}</h2>
        {weekLabel}
        {action ? <div className="justify-self-end">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
