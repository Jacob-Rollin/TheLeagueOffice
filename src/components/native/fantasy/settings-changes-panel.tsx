import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useAuth } from "@/hooks/useAuth";
import { listNativeTransactions } from "@/lib/native-league.functions";
import {
  isNativeSettingsChangeType,
  type NativeSettingsChangeEntry,
} from "@/lib/native-league-settings-changelog";
import { cn } from "@/lib/utils";

type SettingsChangeRow = {
  id: number;
  createdAt: string;
  changedByName: string | null;
  teamName: string | null;
  settingsChanges: NativeSettingsChangeEntry[] | null;
  type: string;
};

function timeAgo(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const mins = Math.max(1, Math.round((Date.now() - at) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Right-rail panel of commissioner settings changes for the whole league.
 * Hidden when there are no recent settings_change transactions.
 */
export function LeagueSettingsChangesPanel({
  linkId,
  className,
  limit = 5,
}: {
  linkId: string;
  className?: string;
  limit?: number;
}) {
  const { user } = useAuth();
  const { data: rows } = useQuery({
    queryKey: ["native-transactions", linkId, "settings-changes"],
    enabled: Boolean(user?.id && linkId),
    staleTime: 15_000,
    queryFn: () => listNativeTransactions({ data: { linkId, limit: 40 } }),
  });

  const notices = useMemo(() => {
    const list = ((rows ?? []) as SettingsChangeRow[]).filter((r) =>
      isNativeSettingsChangeType(r.type),
    );
    return list.slice(0, Math.max(1, limit));
  }, [rows, limit]);

  if (!notices.length) return null;

  return (
    <section className={cn("rounded-xl border border-border bg-card p-4 sm:p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">
          Settings Changes
        </h2>
        <Link
          to="/account/leagues/native/$linkId"
          params={{ linkId }}
          className="text-xs font-semibold text-primary hover:underline"
        >
          League Settings
        </Link>
      </div>
      <ul className="space-y-3">
        {notices.map((notice) => {
          const who =
            notice.changedByName?.trim() ||
            notice.teamName?.trim() ||
            "Commissioner";
          const changes = notice.settingsChanges ?? [];
          const ago = timeAgo(notice.createdAt);
          return (
            <li
              key={notice.id}
              className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-semibold text-slate-900">{who}</p>
                {ago ? <p className="shrink-0 text-[11px] text-slate-500">{ago}</p> : null}
              </div>
              {changes.length ? (
                <ul className="mt-1.5 space-y-1">
                  {changes.slice(0, 6).map((c) => (
                    <li key={`${notice.id}-${c.key}`} className="text-xs leading-snug text-slate-700">
                      <span className="font-medium text-slate-800">{c.label}</span>
                      {": "}
                      <span className="text-slate-500">{c.from}</span>
                      <span className="mx-1 text-slate-400">→</span>
                      <span className="font-medium text-slate-900">{c.to}</span>
                    </li>
                  ))}
                  {changes.length > 6 ? (
                    <li className="text-[11px] text-slate-500">
                      +{changes.length - 6} more
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-slate-600">League settings were updated.</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
