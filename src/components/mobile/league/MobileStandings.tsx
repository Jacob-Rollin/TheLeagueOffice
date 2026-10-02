import { useEffect, useState } from "react";

import { resolveAvatarUrl } from "@/components/playbook/panels";
import type { StandingRow } from "@/lib/league.server";
import { cn } from "@/lib/utils";

export function MobileTeamLogo({ name, logo, className }: { name: string; logo: string | null; className?: string }) {
  const src = resolveAvatarUrl(logo);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-m-border bg-m-chip text-[11px] font-bold uppercase text-m-muted",
        className,
      )}
    >
      {src && !failed ? (
        <img src={src} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
      ) : (
        name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2)
      )}
    </span>
  );
}

const record = (r: StandingRow) => `${r.wins}-${r.losses}${r.ties > 0 ? `-${r.ties}` : ""}`;
const points = (n: number) => n.toFixed(1);

export function MobileStandingsTable({
  rows,
  rankLabel,
  playoffTeams,
  isMine,
}: {
  rows: StandingRow[];
  rankLabel: string;
  /** Draws the playoff cut line after this many rows; 0 hides it. */
  playoffTeams: number;
  isMine: (row: StandingRow) => boolean;
}) {
  return (
    <div className="overflow-x-auto no-scrollbar">
      <table className="w-full min-w-[22rem] border-collapse text-sm">
        <thead>
          <tr className="text-left text-[13px] font-semibold text-m-card-fg">
            <th className="w-14 bg-m-rank-col px-3 py-3 text-center">{rankLabel}</th>
            <th className="px-3 py-3">Team</th>
            <th className="w-12 px-1 py-3 text-right">W-L</th>
            <th className="w-14 px-1 py-3 text-right">PF</th>
            <th className="w-16 py-3 pl-1 pr-3 text-right">PA</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const mine = isMine(row);
            const cut = playoffTeams > 0 && index === playoffTeams;
            return (
              <tr
                key={row.rosterId}
                className={cn(
                  index % 2 === 1 && "bg-m-row-alt",
                  mine && "bg-m-highlight",
                  cut ? "border-t-2 border-dashed border-m-accent" : "border-t border-m-border",
                )}
              >
                <td className="bg-m-rank-col px-3 py-2.5 text-center">
                  <span
                    className={cn(
                      "inline-flex size-7 items-center justify-center rounded-full font-display text-sm font-bold tabnum",
                      index < playoffTeams ? "bg-m-accent text-m-accent-fg" : "text-m-muted",
                    )}
                  >
                    {index + 1}
                  </span>
                </td>
                <td className="max-w-0 px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <MobileTeamLogo name={row.team} logo={row.avatar} />
                    <span className="min-w-0">
                      <span className={cn("block truncate font-semibold", mine && "text-m-accent")}>{row.team}</span>
                      {row.owner ? <span className="block truncate text-xs text-m-muted">{row.owner}</span> : null}
                    </span>
                  </div>
                </td>
                <td className="px-1 py-2.5 text-right tabnum">{record(row)}</td>
                <td className="px-1 py-2.5 text-right tabnum">{points(row.pointsFor)}</td>
                <td className="py-2.5 pl-1 pr-3 text-right tabnum text-m-muted">{points(row.pointsAgainst)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type Seed = { seed: number; row: StandingRow };

/** Standard bracket seeding: top seeds take byes, the rest pair high vs. low. */
function seedBracket(rows: StandingRow[], playoffTeams: number) {
  const field: Seed[] = rows.slice(0, playoffTeams).map((row, i) => ({ seed: i + 1, row }));
  if (field.length < 2) return { byes: [] as Seed[], games: [] as [Seed, Seed][] };
  const bracketSize = 2 ** Math.ceil(Math.log2(field.length));
  const byeCount = bracketSize - field.length;
  const byes = field.slice(0, byeCount);
  const playing = field.slice(byeCount);
  const games: [Seed, Seed][] = [];
  for (let i = 0; i < playing.length / 2; i += 1) {
    games.push([playing[i]!, playing[playing.length - 1 - i]!]);
  }
  return { byes, games };
}

export function MobilePlayoffPicture({
  rows,
  playoffTeams,
  isMine,
}: {
  rows: StandingRow[];
  playoffTeams: number;
  isMine: (row: StandingRow) => boolean;
}) {
  const { byes, games } = seedBracket(rows, playoffTeams);
  const outside = rows.slice(playoffTeams, playoffTeams + 2);
  const roundLabel = byes.length
    ? "Wild Card Round"
    : games.length === 1
      ? "Championship"
      : games.length === 2
        ? "Semifinals"
        : "Quarterfinals";

  if (!games.length) {
    return <p className="px-4 py-8 text-center text-sm text-m-muted">Playoff seeding is not available yet.</p>;
  }

  return (
    <div className="space-y-5 px-4 pb-5">
      <p className="text-center text-sm text-m-muted">If the playoffs started today</p>

      <div>
        <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-widest text-m-muted">
          {roundLabel}
        </h3>
        <div className="space-y-3">
          {games.map(([high, low]) => (
            <div key={high.seed} className="overflow-hidden rounded-lg border border-m-border">
              <SeedLine seed={high} mine={isMine(high.row)} />
              <div className="border-t border-m-border" />
              <SeedLine seed={low} mine={isMine(low.row)} />
            </div>
          ))}
        </div>
      </div>

      {byes.length ? (
        <div>
          <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-widest text-m-muted">First Round Bye</h3>
          <div className="overflow-hidden rounded-lg border border-m-border">
            {byes.map((seed, i) => (
              <div key={seed.seed} className={cn(i > 0 && "border-t border-m-border")}>
                <SeedLine seed={seed} mine={isMine(seed.row)} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {outside.length ? (
        <div>
          <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-widest text-m-muted">On the Bubble</h3>
          <div className="overflow-hidden rounded-lg border border-dashed border-m-border">
            {outside.map((row, i) => (
              <div key={row.rosterId} className={cn(i > 0 && "border-t border-m-border")}>
                <SeedLine seed={{ seed: playoffTeams + i + 1, row }} mine={isMine(row)} muted />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SeedLine({ seed, mine, muted }: { seed: Seed; mine: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3 px-3 py-2.5", mine && "bg-m-highlight", muted && "opacity-75")}>
      <span
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold",
          muted ? "bg-m-chip text-m-muted" : "bg-m-accent text-m-accent-fg",
        )}
      >
        {seed.seed}
      </span>
      <MobileTeamLogo name={seed.row.team} logo={seed.row.avatar} className="size-8" />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm font-semibold", mine && "text-m-accent")}>{seed.row.team}</span>
        <span className="block truncate text-xs text-m-muted">{seed.row.owner}</span>
      </span>
      <span className="shrink-0 text-right text-sm tabnum">
        <span className="block font-semibold">{record(seed.row)}</span>
        <span className="block text-xs text-m-muted">{points(seed.row.pointsFor)} PF</span>
      </span>
    </div>
  );
}
