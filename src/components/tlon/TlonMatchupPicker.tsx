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

/** Dark channel rail — flip between league matchups like network games. */
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
    <div className="overflow-x-auto">
      <div className="flex min-w-min gap-1.5">
        {options.map((opt) => {
          const active = opt.id === selectedId;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelect(opt.id)}
              className={cn(
                "flex min-w-[9.5rem] items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-200",
                active
                  ? "bg-white/15 ring-1 ring-white/40"
                  : "bg-transparent hover:bg-white/8",
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
                <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-white/90">
                  {opt.isMine ? "Your matchup" : opt.label}
                </p>
                <p className="tabular-nums text-[11px] text-white/60">
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
