import { Link } from "@tanstack/react-router";
import { UserRound } from "lucide-react";
import { useMemo, useState } from "react";

import { playerImage, teamLogo } from "@/components/draft/PlayerAvatar";
import type { Pos } from "@/lib/draft";
import { getTeamPrimaryColor } from "@/lib/nfl-teams";
import type { InjuryReportItem } from "@/lib/players.server";
import { cn } from "@/lib/utils";

const STATUS_CHIP: Record<string, string> = {
  IR: "bg-rose-50 text-rose-600",
  OUT: "bg-rose-50 text-rose-600",
  SUSP: "bg-rose-50 text-rose-600",
  PUP: "bg-orange-50 text-orange-600",
  D: "bg-orange-50 text-orange-600",
  Q: "bg-amber-50 text-amber-700",
  NA: "bg-rose-50 text-rose-600",
  DNR: "bg-rose-50 text-rose-600",
  COV: "bg-rose-50 text-rose-600",
};

const BANNER_CHIP_TEXT: Record<string, string> = {
  IR: "text-rose-600",
  OUT: "text-rose-600",
  SUSP: "text-rose-600",
  PUP: "text-orange-600",
  D: "text-orange-600",
  Q: "text-amber-700",
  NA: "text-rose-600",
  DNR: "text-rose-600",
  COV: "text-rose-600",
};

export const INJURY_STATUS_LABEL: Record<string, string> = {
  IR: "Injured Reserve",
  OUT: "Out",
  SUSP: "Suspended",
  PUP: "PUP List",
  D: "Doubtful",
  Q: "Questionable",
  NA: "Not Active",
  DNR: "Did Not Report",
  COV: "COVID-19",
};

export type InjuryReportOwner = { team: string; isMine: boolean };

function formatPublished(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}

function formatReturn(iso: string | null): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at) || at < Date.now() - 24 * 60 * 60 * 1000) return null;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function ReportHeadshot({ item }: { item: InjuryReportItem }) {
  const sources = useMemo(() => {
    const list: string[] = [];
    if (item.sleeperId) list.push(playerImage(item.sleeperId, item.pos as Pos, item.team ?? ""));
    if (item.headshot) list.push(item.headshot);
    return list;
  }, [item.sleeperId, item.pos, item.team, item.headshot]);
  const [attempt, setAttempt] = useState(0);
  const src = sources[attempt];
  const frame =
    "relative z-20 flex size-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white/40 shadow-sm";

  if (!src) {
    return (
      <span className={cn(frame, "bg-white/20")} aria-hidden="true">
        <UserRound className="size-9 translate-y-[6%] text-white/70" strokeWidth={1.75} />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setAttempt((n) => n + 1)}
      className={cn(frame, "bg-white/10 object-cover")}
    />
  );
}

/** Team-branded news card used by Injury Reports and My Team → News. */
export function InjuryReportCard({
  item,
  owner,
  showOwnership,
  onOpen,
}: {
  item: InjuryReportItem;
  owner: InjuryReportOwner | null;
  showOwnership: boolean;
  onOpen: (id: string) => void;
}) {
  const returnLabel = formatReturn(item.returnDate);
  const headlineClass = "text-left text-base font-bold leading-snug text-blue-700 hover:underline";
  const logo = teamLogo(item.team);
  const bannerLink = "text-white/90 hover:text-white hover:underline";

  return (
    <li className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div
        className="relative flex items-center overflow-hidden px-5 py-4"
        style={{ backgroundColor: getTeamPrimaryColor(item.team) }}
      >
        <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-r from-black/25 via-transparent to-transparent" />
        {logo ? (
          <img
            src={logo}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-1/2 z-0 h-24 w-24 -translate-y-1/2 select-none object-contain opacity-[0.14]"
          />
        ) : null}
        <div className="relative z-20 flex min-w-0 items-center gap-4">
          {item.sleeperId ? (
            <button
              type="button"
              onClick={() => onOpen(item.sleeperId!)}
              className="flex-shrink-0"
              aria-label={`Open ${item.playerName} details`}
            >
              <ReportHeadshot item={item} />
            </button>
          ) : (
            <ReportHeadshot item={item} />
          )}
          <div className="min-w-0">
            {item.sleeperId ? (
              <button
                type="button"
                onClick={() => onOpen(item.sleeperId!)}
                className="block truncate text-left text-base font-black tracking-wide text-white hover:opacity-90"
              >
                {item.playerName}
              </button>
            ) : (
              <p className="truncate text-base font-black tracking-wide text-white">{item.playerName}</p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-white/85">
                {item.pos} · {item.team ?? "FA"}
              </span>
              <span
                className={cn(
                  "rounded bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  item.statusShort
                    ? (BANNER_CHIP_TEXT[item.statusShort] ?? "text-slate-600")
                    : "text-emerald-700",
                )}
              >
                {item.statusShort ? (INJURY_STATUS_LABEL[item.statusShort] ?? item.status) : "Active"}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] font-medium">
              {item.sleeperId ? (
                <button type="button" onClick={() => onOpen(item.sleeperId!)} className={bannerLink}>
                  Player Card
                </button>
              ) : null}
              {item.sleeperId && item.team ? <span className="text-white/50">·</span> : null}
              {item.team ? (
                <Link to="/nfl-team/$nflId" params={{ nflId: item.team }} className={bannerLink}>
                  Team Page
                </Link>
              ) : null}
              {item.link && (item.sleeperId || item.team) ? <span className="text-white/50">·</span> : null}
              {item.link ? (
                <a href={item.link} target="_blank" rel="noreferrer" className={bannerLink}>
                  More News
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="px-5 py-5">
        {item.sleeperId ? (
          <button type="button" onClick={() => onOpen(item.sleeperId!)} className={headlineClass}>
            {item.headline}
          </button>
        ) : (
          <h2 className={headlineClass}>{item.headline}</h2>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {item.published ? (
            <>
              <span>{formatPublished(item.published)}</span>
              <span className="text-slate-300">·</span>
            </>
          ) : null}
          <span>{item.source}</span>
          {item.sourceStatusShort ? (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                STATUS_CHIP[item.sourceStatusShort] ?? "bg-slate-100 text-slate-600",
              )}
            >
              {INJURY_STATUS_LABEL[item.sourceStatusShort] ?? item.sourceStatus}
            </span>
          ) : item.sourceStatusShort === "" ? (
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
              Active
            </span>
          ) : null}
          {returnLabel ? <span className="font-medium text-slate-600">Est. return {returnLabel}</span> : null}
          {showOwnership ? (
            owner ? (
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  owner.isMine ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-600",
                )}
              >
                {owner.isMine ? "On Your Team" : `Rostered by ${owner.team}`}
              </span>
            ) : (
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                Available
              </span>
            )
          ) : null}
        </div>

        <p className="mt-3 text-sm leading-relaxed text-slate-700">{item.news}</p>
        {item.analysis ? (
          <p className="mt-2 text-sm leading-relaxed text-slate-700">
            <span className="font-bold italic text-slate-900">Fantasy Impact:</span> {item.analysis}
          </p>
        ) : null}
      </div>
    </li>
  );
}
