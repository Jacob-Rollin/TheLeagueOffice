import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Trophy } from "lucide-react";

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
              <Fragment key={row.rosterId}>
              {cut ? (
                <tr aria-hidden>
                  <td colSpan={5} className="relative h-0 p-0">
                    <div className="absolute inset-x-0 top-0 z-10 flex -translate-y-1/2 items-center">
                      <span className="flex-1 border-t-2 border-dashed border-m-accent" />
                      <span className="rounded-full bg-m-card px-2 font-display text-[10px] font-bold uppercase leading-none tracking-widest text-m-accent">
                        Playoff Line
                      </span>
                      <span className="flex-1 border-t-2 border-dashed border-m-accent" />
                    </div>
                  </td>
                </tr>
              ) : null}
              <tr
                className={cn(
                  index % 2 === 1 && "bg-m-row-alt",
                  mine && "bg-m-highlight",
                  !cut && "border-t border-m-border",
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
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type Seed = { seed: number; row: StandingRow };
type Matchup = [Seed, Seed];
/** Fixed seed or a TBD slot labeled with the two possible teams. */
type BracketSlot =
  | { kind: "seed"; seed: Seed }
  | { kind: "tbd"; label: string; mine: boolean };

/** Standard bracket seeding: top seeds take byes, the rest pair high vs. low. */
function seedBracket(rows: StandingRow[], playoffTeams: number) {
  const field: Seed[] = rows.slice(0, playoffTeams).map((row, i) => ({ seed: i + 1, row }));
  if (field.length < 2) return { byes: [] as Seed[], games: [] as Matchup[] };
  const bracketSize = 2 ** Math.ceil(Math.log2(field.length));
  const byeCount = bracketSize - field.length;
  const byes = field.slice(0, byeCount);
  const playing = field.slice(byeCount);
  const games: Matchup[] = [];
  for (let i = 0; i < playing.length / 2; i += 1) {
    games.push([playing[i]!, playing[playing.length - 1 - i]!]);
  }
  return { byes, games };
}

function shortName(seed: Seed) {
  const owner = seed.row.owner?.trim();
  if (owner) return owner;
  return seed.row.team;
}

function tbdLabel(a: Seed, b: Seed) {
  return `${shortName(a)} / ${shortName(b)}`;
}

function round1Title(byes: Seed[], games: Matchup[]) {
  if (byes.length) return "Wild Card";
  if (games.length === 1) return "Championship";
  return "Round 1";
}

export function MobilePlayoffPicture({
  rows,
  playoffTeams,
  isMine,
  playoffStartWeek = 15,
}: {
  rows: StandingRow[];
  playoffTeams: number;
  isMine: (row: StandingRow) => boolean;
  /** First NFL week of the fantasy playoffs — used for round labels. */
  playoffStartWeek?: number;
}) {
  const { byes, games } = seedBracket(rows, playoffTeams);
  const outside = rows.slice(playoffTeams, playoffTeams + 2);
  const startWeek = Math.max(1, Math.min(18, Math.floor(playoffStartWeek) || 15));

  if (!games.length) {
    return (
      <p className="px-4 py-8 text-center text-sm text-m-muted">Playoff seeding is not available yet.</p>
    );
  }

  const hasByes = byes.length > 0;
  const r1Label = round1Title(byes, games);

  /** Next-round matchups after R1 (byes vs WC winners, or championship TBDs for 4-team). */
  const advanceMatchups: { top: BracketSlot; bottom: BracketSlot }[] = hasByes
    ? byes.map((bye, i) => {
        const linked = games[games.length - 1 - i] ?? games[i]!;
        return {
          top: { kind: "seed", seed: bye },
          bottom: {
            kind: "tbd",
            label: tbdLabel(linked[0], linked[1]),
            mine: isMine(linked[0].row) || isMine(linked[1].row),
          },
        };
      })
    : games.length >= 2
      ? [
          {
            top: {
              kind: "tbd",
              label: tbdLabel(games[0]![0], games[0]![1]),
              mine: isMine(games[0]![0].row) || isMine(games[0]![1].row),
            },
            bottom: {
              kind: "tbd",
              label: tbdLabel(games[1]![0], games[1]![1]),
              mine: isMine(games[1]![0].row) || isMine(games[1]![1].row),
            },
          },
        ]
      : [];

  const showAdvanceColumn = hasByes || games.length >= 2;
  const championshipFromByes: [BracketSlot, BracketSlot] | null =
    hasByes && advanceMatchups.length >= 2
      ? [
          {
            kind: "tbd",
            label: `Winner · Semi 1`,
            mine:
              isMine(byes[0]!.row) ||
              isMine((games[games.length - 1] ?? games[0])![0].row) ||
              isMine((games[games.length - 1] ?? games[0])![1].row),
          },
          {
            kind: "tbd",
            label: `Winner · Semi 2`,
            mine:
              isMine(byes[1]!.row) ||
              isMine((games[0] ?? games[games.length - 1])![0].row) ||
              isMine((games[0] ?? games[games.length - 1])![1].row),
          },
        ]
      : null;

  const finalsWeek = startWeek + (hasByes ? 2 : games.length >= 2 ? 1 : 0);
  const semisWeek = startWeek + (hasByes ? 1 : 0);
  const showThirdPlace = !hasByes && games.length === 2;

  const thirdPlaceBlock = showThirdPlace ? (
    <FinalsBlock
      title="3rd Place"
      week={finalsWeek}
      top={{
        kind: "tbd",
        label: tbdLabel(games[0]![0], games[0]![1]),
        mine: isMine(games[0]![0].row) || isMine(games[0]![1].row),
      }}
      bottom={{
        kind: "tbd",
        label: tbdLabel(games[1]![0], games[1]![1]),
        mine: isMine(games[1]![0].row) || isMine(games[1]![1].row),
      }}
      isMine={isMine}
    />
  ) : null;

  return (
    <div className="space-y-5 pb-5">
      <p className="px-3 text-center text-sm text-m-muted">If the playoffs started today</p>

      {/* Full-width bracket — no horizontal scroll. 3rd Place sits below the connector band. */}
      <div className="px-3">
        <div className="flex w-full items-stretch gap-0">
          <BracketColumn title={r1Label} week={startWeek} className="justify-around gap-5">
            {games.map(([high, low]) => (
              <MatchupCard
                key={`${high.seed}-${low.seed}`}
                top={{ kind: "seed", seed: high }}
                bottom={{ kind: "seed", seed: low }}
                isMine={isMine}
              />
            ))}
          </BracketColumn>

          {showAdvanceColumn ? (
            <>
              <BracketConnectors />
              <BracketColumn
                title={hasByes ? "Semifinals" : "Finals"}
                week={hasByes ? semisWeek : finalsWeek}
                className={hasByes ? "justify-around gap-5" : "justify-center"}
              >
                {hasByes ? (
                  advanceMatchups.map((g, i) => (
                    <MatchupCard key={`semi-${i}`} top={g.top} bottom={g.bottom} isMine={isMine} />
                  ))
                ) : (
                  <FinalsBlock
                    title="Championship"
                    week={finalsWeek}
                    top={advanceMatchups[0]!.top}
                    bottom={advanceMatchups[0]!.bottom}
                    isMine={isMine}
                    trophy
                  />
                )}
              </BracketColumn>
            </>
          ) : null}

          {championshipFromByes ? (
            <>
              <BracketConnectors />
              <BracketColumn title="Finals" week={finalsWeek} className="justify-center">
                <FinalsBlock
                  title="Championship"
                  week={finalsWeek}
                  top={championshipFromByes[0]}
                  bottom={championshipFromByes[1]}
                  isMine={isMine}
                  trophy
                />
              </BracketColumn>
            </>
          ) : null}
        </div>

        {thirdPlaceBlock ? (
          <div className="mt-8 flex w-full">
            <div className="min-w-0 flex-1" aria-hidden />
            <div className="w-5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">{thirdPlaceBlock}</div>
          </div>
        ) : null}
      </div>

      {outside.length ? (
        <div className="px-3">
          <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-widest text-m-muted">
            On the Bubble
          </h3>
          <div className="overflow-hidden rounded-xl border border-dashed border-m-border bg-m-chip/40">
            {outside.map((row, i) => (
              <div key={row.rosterId} className={cn(i > 0 && "border-t border-m-border")}>
                <BracketTeamRow
                  slot={{ kind: "seed", seed: { seed: playoffTeams + i + 1, row } }}
                  mine={isMine(row)}
                  muted
                  isMine={isMine}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BracketColumn({
  title,
  week,
  children,
  className,
}: {
  title: string;
  week: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="mb-2.5 px-0.5">
        <p className="truncate font-display text-[10px] font-bold uppercase tracking-[0.12em] text-m-muted">
          {title}
          <span className="font-semibold normal-case tracking-normal text-m-muted/80">
            {" "}
            (Week {week})
          </span>
        </p>
      </div>
      <div className={cn("flex flex-1 flex-col", className)}>{children}</div>
    </div>
  );
}

/** Single elbow tree from Round 1 into the Championship mid-band. */
function BracketConnectors() {
  return (
    <div className="flex w-5 shrink-0 flex-col self-stretch px-0.5" aria-hidden>
      <div className="mb-2.5 h-[1.125rem]" />
      <div className="relative min-h-[7.5rem] flex-1">
        <span className="absolute left-0 top-[12%] bottom-[12%] w-[55%] rounded-r-md border border-l-0 border-m-accent/50" />
        <span className="absolute right-0 top-1/2 h-px w-[45%] -translate-y-1/2 bg-m-accent/50" />
      </div>
    </div>
  );
}

function MatchupCard({
  top,
  bottom,
  isMine,
}: {
  top: BracketSlot;
  bottom: BracketSlot;
  isMine: (row: StandingRow) => boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-m-border bg-m-card shadow-sm">
      <BracketTeamRow slot={top} isMine={isMine} />
      <div className="border-t border-m-border" />
      <BracketTeamRow slot={bottom} isMine={isMine} />
    </div>
  );
}

function FinalsBlock({
  title,
  week,
  top,
  bottom,
  isMine,
  trophy,
}: {
  title: string;
  week: number;
  top: BracketSlot;
  bottom: BracketSlot;
  isMine: (row: StandingRow) => boolean;
  trophy?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 px-0.5">
        {trophy ? <Trophy className="size-3 shrink-0 text-amber-500" aria-hidden /> : null}
        <p className="truncate font-display text-[10px] font-bold uppercase tracking-[0.1em] text-m-muted">
          {title}
          <span className="ml-1 font-semibold normal-case tracking-normal text-m-muted/80">
            · Wk {week}
          </span>
        </p>
      </div>
      <MatchupCard top={top} bottom={bottom} isMine={isMine} />
    </div>
  );
}

function BracketTeamRow({
  slot,
  isMine,
  mine: mineOverride,
  muted,
}: {
  slot: BracketSlot;
  isMine: (row: StandingRow) => boolean;
  mine?: boolean;
  muted?: boolean;
}) {
  if (slot.kind === "tbd") {
    const mine = mineOverride ?? slot.mine;
    return (
      <div
        className={cn(
          "flex min-h-[2.5rem] items-center gap-1.5 px-2 py-1.5",
          mine && "bg-m-highlight",
          muted && "opacity-75",
        )}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-m-border bg-m-chip text-[9px] font-bold text-m-muted">
          ?
        </span>
        <span className={cn("min-w-0 flex-1 truncate text-[12px] font-semibold", mine && "text-m-accent")}>
          {slot.label}
        </span>
      </div>
    );
  }

  const { seed } = slot;
  const mine = mineOverride ?? isMine(seed.row);
  return (
    <div
      className={cn(
        "flex min-h-[2.5rem] items-center gap-1.5 px-2 py-1.5",
        mine && "bg-m-highlight",
        muted && "opacity-75",
      )}
    >
      <span className="relative shrink-0">
        <MobileTeamLogo name={seed.row.team} logo={seed.row.avatar} className="size-7" />
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full border border-m-card font-display text-[8px] font-bold leading-none",
            muted ? "bg-m-chip text-m-muted" : "bg-m-accent text-m-accent-fg",
          )}
        >
          {seed.seed}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[12px] font-semibold leading-tight", mine && "text-m-accent")}>
          {shortName(seed)}
        </span>
      </span>
      <span className="shrink-0 text-right text-[11px] font-semibold tabnum text-m-muted">
        {record(seed.row)}
      </span>
    </div>
  );
}
