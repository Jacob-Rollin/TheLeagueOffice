import { MatchupTeamAvatar } from "@/components/playbook/MatchupPreviewCard";
import { cn } from "@/lib/utils";

export type TlonMatchupOption = {
  id: string;
  label: string;
  isMine: boolean;
  leftName: string;
  rightName: string;
  leftLogo?: string | null;
  rightLogo?: string | null;
  leftLive: number;
  rightLive: number;
};

function shortScore(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

export function TlonMatchupPicker({
  options,
  selectedId,
  onSelect,
  platform,
  leagueKey,
}: {
  options: TlonMatchupOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  platform?: string | null;
  leagueKey?: string | null;
}) {
  if (!options.length) return null;

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex min-w-min gap-2">
        {options.map((opt) => {
          const active = opt.id === selectedId;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelect(opt.id)}
              className={cn(
                "flex min-w-[11rem] items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors",
                active
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-slate-800 hover:border-blue-300",
              )}
            >
              <div className="flex -space-x-1.5">
                <MatchupTeamAvatar
                  name={opt.leftName}
                  logo={opt.leftLogo ?? null}
                  platform={platform ?? null}
                  cacheKey={`${leagueKey ?? "tlon"}-pick-${opt.id}-l`}
                  size="sm"
                />
                <MatchupTeamAvatar
                  name={opt.rightName}
                  logo={opt.rightLogo ?? null}
                  platform={platform ?? null}
                  cacheKey={`${leagueKey ?? "tlon"}-pick-${opt.id}-r`}
                  size="sm"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-[11px] font-semibold", active ? "text-white" : "text-slate-800")}>
                  {opt.isMine ? "Your matchup" : opt.label}
                </p>
                <p
                  className={cn(
                    "tabular-nums text-[11px]",
                    active ? "text-white/85" : "text-slate-500",
                  )}
                >
                  {shortScore(opt.leftLive)} – {shortScore(opt.rightLive)}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
