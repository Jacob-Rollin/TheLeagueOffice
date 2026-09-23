import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import { hydrateActivityMove } from "@/components/dashboard/ActivityFeed";
import {
  playbookCardClass,
  resolveAvatarUrl,
} from "@/components/playbook/panels";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useActiveMatchups } from "@/hooks/useActiveMatchups";
import { useLeagueActivity } from "@/hooks/useLeagueActivity";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Player, Pos } from "@/lib/draft";
import { starterRequirements } from "@/lib/power-rankings";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/playbook/press-room")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Press Room — Playbook" }],
  }),
  component: PressRoomPage,
});

type ArticleTab = "recap" | "preview" | "waiver";

const ARTICLE_TABS: { id: ArticleTab; label: string }[] = [
  { id: "recap", label: "Post-Week Recap" },
  { id: "preview", label: "Matchup Preview" },
  { id: "waiver", label: "Waiver Sweep" },
];

/** Deterministic editorial phrasing banks — continuations after the lead identity. */
const HIGH_SCORE_LINES = [
  "led the league this week with an impressive [PTS]",
  "completely set the scoreboard on fire, posting a massive [PTS] to lead the league",
  "delivered an absolute masterclass performance, dominant from kickoff to lead all scorers with [PTS]",
] as const;

const BOTTOM_OF_THE_PILE_LINES = [
  "was left in the dust this week with a lowly [PTS]",
  "found themselves stuck in neutral this week, failing to generate momentum and finishing at the bottom with just [PTS]",
] as const;

const BRAGGING_RIGHTS_LINES = [
  "blew out [LOSER] by [MARGIN] ([W_PTS] to [L_PTS])",
  "left zero room for doubt, delivering a massive [MARGIN] blowout victory over [LOSER] ([W_PTS] to [L_PTS])",
] as const;

const BAD_BEAT_LINES = [
  "fell to [WINNER] by a razor thin margin of just [MARGIN]. Keep an eye on those stat corrections.",
  "came up short against [WINNER] by only [MARGIN] in a heartbreaker that could swing on a single correction.",
] as const;

const LUCKY_BREAK_LINES = [
  "owes a gift to whoever made the schedule. They stole a W this week despite [LOSER] being the only team they would have beaten!",
  "caught every break on the schedule, escaping with a win against [LOSER] as the only club they outscored this week.",
] as const;

const NOT_SO_LUCKY_LINES = [
  "posted a stout [PTS] and still took the loss to [WINNER]. Sometimes the box score is cruel.",
  "piled up [PTS] only to fall to [WINNER] in a tough draw.",
] as const;

const MANAGER_OF_THE_WEEK_LINES = [
  "ran the sharpest desk of the week at [EFF] coaching efficiency.",
  "maximized the roster board, posting [EFF] coaching efficiency to earn Gridiron Genius.",
] as const;

const WAIVER_WIRE_GEM_LINES = [
  "paid off immediately for [TEAM], putting up [PTS] after coming off the wire.",
  "delivered [PTS] for [TEAM] in the first look after coming off the wire.",
] as const;

function pickPhrase(templates: readonly string[], seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return templates[hash % templates.length] ?? templates[0] ?? "";
}

function fillPhrase(template: string, vars: Record<string, string>): string {
  return template.replace(/\[([A-Z_]+)\]/g, (_match, key: string) => vars[key] ?? "");
}

function pts2(value: number): string {
  return (Number(value) || 0).toFixed(2);
}

function eff1(value: number): string {
  return Number(value).toFixed(1);
}

/** Wrap a metric token so the narrative renderer can bold it. */
function metric(value: string): string {
  return `«${value}»`;
}

/** Wrap a team identity so the narrative renderer can bold it (non-interactive). */
function nameToken(value: string): string {
  return `‹${value}›`;
}

type BriefPlayer = {
  id: string;
  name: string;
  points: number;
  rosterId: number | null;
  teamName: string;
};

/**
 * Wrap a player identity as a clickable modal token.
 * Falls back to a plain bold name when id/name are unresolved.
 */
function playerToken(player: BriefPlayer | null | undefined, fallbackName?: string): string {
  const name = player?.name?.trim() || fallbackName?.trim() || "";
  const id = player?.id?.trim() || "";
  if (id && name) return `⟦${id}¦${name}⟧`;
  if (name) return nameToken(name);
  return nameToken("a featured playmaker");
}

/** Soft franchise label when roster ownership cannot be resolved. */
const UNNAMED_FRANCHISE = "An Unnamed Franchise";

type RosterOwnership = {
  rosterId: number;
  teamName: string;
};

/** Map every rostered player id → verified fantasy club from leagueRosters. */
function buildRosterOwnership(teams: { slot: number; team: string; players: Player[] }[]): Map<
  string,
  RosterOwnership
> {
  const map = new Map<string, RosterOwnership>();
  for (const team of teams) {
    const teamName = team.team?.trim() || UNNAMED_FRANCHISE;
    for (const player of team.players ?? []) {
      if (!player?.id) continue;
      map.set(String(player.id), { rosterId: team.slot, teamName });
    }
  }
  return map;
}

/**
 * Cross-reference a player id against verified leagueRosters ownership.
 * Never invents mock franchise names — only real roster labels or a soft fallback.
 */
function getTrueRosterName(
  playerId: string,
  ownership: Map<string, RosterOwnership>,
  matchupTeamName?: string | null,
): string {
  const owned = ownership.get(String(playerId));
  if (owned?.teamName?.trim()) return owned.teamName.trim();
  const fromMatchup = matchupTeamName?.trim();
  if (fromMatchup) return fromMatchup;
  return UNNAMED_FRANCHISE;
}

function getTrueRosterId(
  playerId: string,
  ownership: Map<string, RosterOwnership>,
  matchupRosterId?: number | null,
): number | null {
  const owned = ownership.get(String(playerId));
  if (owned?.rosterId != null) return owned.rosterId;
  if (matchupRosterId != null && matchupRosterId > 0) return matchupRosterId;
  return null;
}

/** Bench-blame copy locked to the player's true roster + that club's matchup result. */
function generateBenchSentence(
  player: BriefPlayer,
  narrative: "won_anyway" | "cost_matchup",
): string {
  const teamLabel = nameToken(player.teamName?.trim() || UNNAMED_FRANCHISE);
  const pts = metric(`${pts2(player.points)}pts`);
  if (narrative === "won_anyway") {
    return ` The costly coaching miss left ${playerToken(player)} on the pine for ${teamLabel} after a ${pts} eruption, but the squad's starting core did more than enough to secure the victory regardless.`;
  }
  return ` The costly coaching miss left ${playerToken(player)} on the pine for ${teamLabel} after a ${pts} eruption that completely cost them the matchup and would have rewritten the standings.`;
}

function renderSentence(
  sentence: string,
  onOpenPlayer?: (id: string) => void,
): ReactNode {
  const normalized = sentence.replace(/\*\*([^*]+)\*\*/g, "«$1»");
  const parts = normalized
    .split(/(«[^»]+»|‹[^›]+›|⟦[^⟧]+⟧)/g)
    .filter((part) => part.length > 0);
  return parts.map((part, index) => {
    if (part.startsWith("«") && part.endsWith("»")) {
      return (
        <span key={index} className="font-mono font-black text-slate-900">
          {part.slice(1, -1)}
        </span>
      );
    }
    if (part.startsWith("‹") && part.endsWith("›")) {
      return (
        <span key={index} className="font-black text-slate-900">
          {part.slice(1, -1)}
        </span>
      );
    }
    if (part.startsWith("⟦") && part.endsWith("⟧")) {
      const inner = part.slice(1, -1);
      const sep = inner.indexOf("¦");
      const id = sep >= 0 ? inner.slice(0, sep) : "";
      const label = sep >= 0 ? inner.slice(sep + 1) : inner;
      if (id && onOpenPlayer) {
        return (
          <button
            key={index}
            type="button"
            onClick={() => onOpenPlayer(id)}
            className="cursor-pointer font-black text-slate-900 transition-colors hover:text-blue-600 hover:underline focus:outline-none"
          >
            {label}
          </button>
        );
      }
      return (
        <span key={index} className="font-black text-slate-900">
          {label}
        </span>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

type EditorialBrief = {
  week: number;
  apexTeam: string;
  apexPoints: number;
  apexLogo: string | null;
  stalledTeam: string;
  stalledPoints: number;
  woodshedWinner: string;
  woodshedLoser: string;
  woodshedMargin: number;
  razorWinner: string;
  razorLoser: string;
  razorMargin: number;
  geniusTeam: string;
  geniusEfficiency: number;
  waiverPlayer: string;
  waiverTeam: string;
  waiverPoints: number;
  waiverLogo: string | null;
  waiverPlayerId: string | null;
  previewFocusTeam: string;
  previewFocusLogo: string | null;
  /** Apex team's top started scorer (roster-locked to the week-high club). */
  mvpPlayer: BriefPlayer | null;
  /** Highest confirmed bench explosion (roster-tagged for win/loss narrative). */
  benchBustPlayer: BriefPlayer | null;
  /**
   * Bench-blame framing for the explosion owner:
   * - won_anyway: club still won despite the leave-in
   * - cost_matchup: club lost and the bench points exceed the loss margin
   */
  benchBustNarrative: "won_anyway" | "cost_matchup" | null;
  /** Matchup-advantage weapon for the preview focus side (started players only). */
  previewStarPlayer: BriefPlayer | null;
  previewPairs: {
    home: string;
    away: string;
    homeProj: number;
    awayProj: number;
    homeLogo: string | null;
    awayLogo: string | null;
  }[];
};

function fantasyBrandColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 58% 38%)`;
}

const ARTICLE_BG_RECAP =
  "https://images.unsplash.com/photo-1459865264687-595d652de67e?auto=format&fit=crop&w=1800&q=80";
const ARTICLE_BG_PREVIEW = "/football-yard-line.jpg";
const ARTICLE_BG_WAIVER = "/locker-room.jpg";

function getArticleBackgroundImage(tab: ArticleTab): string {
  if (tab === "preview") return ARTICLE_BG_PREVIEW;
  if (tab === "waiver") return ARTICLE_BG_WAIVER;
  return ARTICLE_BG_RECAP;
}

type GeneratedArticle = {
  title: string;
  paragraphs: string[];
};

function generateRecapArticle(brief: EditorialBrief): GeneratedArticle {
  const topTeam = brief.apexTeam.trim() || UNNAMED_FRANCHISE;
  const lowTeam = brief.stalledTeam.trim() || UNNAMED_FRANCHISE;
  const badBeatWinner = brief.razorWinner.trim() || UNNAMED_FRANCHISE;
  const badBeatLoser = brief.razorLoser.trim() || UNNAMED_FRANCHISE;
  const margin = pts2(brief.razorMargin);
  const apexPts = pts2(brief.apexPoints);
  const stalledPts = pts2(brief.stalledPoints);
  const genius = brief.geniusTeam.trim() || topTeam;
  const geniusEff = eff1(brief.geniusEfficiency || 0);
  const activeMvpPlayer = brief.mvpPlayer;
  const mvpPts = pts2(activeMvpPlayer?.points ?? 0);

  const mvpClause = activeMvpPlayer
    ? ` The turning point of the slate came down to a sensational performance by ${playerToken(activeMvpPlayer)}, who exploded for a massive ${metric(`${mvpPts}pts`)} to comfortably anchor the victory for ${nameToken(activeMvpPlayer.teamName || topTeam)}.`
    : ` The desk will keep watching for a breakout starter to seize the MVP narrative as more box scores settle.`;

  const bustClause =
    brief.benchBustPlayer && brief.benchBustNarrative
      ? generateBenchSentence(brief.benchBustPlayer, brief.benchBustNarrative)
      : ` Every unused flex point on the bench remains a live threat to next week's Gridiron Genius board.`;

  return {
    title: `WEEK RECAP: ${topTeam.toUpperCase()} DOMINATES THE SLATE AS ${badBeatLoser.toUpperCase()} FALLS IN A HEARTBREAKER`,
    paragraphs: [
      `The books are officially closed on another wild week of league action, and the fallout has left managers scrambling to adjust their strategies. Headlining the week was a masterclass performance by ${nameToken(topTeam)}, who completely set the scoreboard on fire to post a week-high total of ${metric(`${apexPts}pts`)}.${mvpClause} On the opposite side of the ledger, ${nameToken(lowTeam)} found themselves stuck in neutral, failing to generate offensive momentum and finishing at the bottom of the pile with just ${metric(`${stalledPts}pts`)}.`,
      `The true drama of the week unfolded in a razor-thin matchup that will be talked about for the rest of the season. ${nameToken(badBeatWinner)} narrowly escaped with a victory, handing a heartbreaking defeat to ${nameToken(badBeatLoser)} by a microscopic margin of just ${metric(`${margin}pts`)}.${bustClause}`,
      `${nameToken(genius)} earned Gridiron Genius honors with ${metric(`${geniusEff}%`)} coaching efficiency, squeezing every available point from the optimal board. As we look ahead, managers must audit their coaching efficiency metrics to ensure optimal player optimization before the next wave of kickoff whistles blows.`,
    ],
  };
}

function generatePreviewArticle(brief: EditorialBrief): GeneratedArticle {
  const pairs = brief.previewPairs;
  const headlinePair = pairs[0];
  const spotlightA = (headlinePair?.home || brief.apexTeam).trim() || UNNAMED_FRANCHISE;
  const spotlightB = (headlinePair?.away || brief.stalledTeam).trim() || UNNAMED_FRANCHISE;
  const projA = pts2(headlinePair?.homeProj ?? brief.apexPoints);
  const projB = pts2(headlinePair?.awayProj ?? brief.stalledPoints);
  const star = brief.previewStarPlayer;
  const starPts = pts2(star?.points ?? 0);
  const focusClub =
    (brief.previewFocusTeam || star?.teamName || spotlightB || spotlightA).trim() ||
    UNNAMED_FRANCHISE;

  const starClause = star
    ? ` The Press Room flags ${playerToken(star)} as the projected matchup-advantage weapon for ${nameToken(focusClub)}, riding a recent ${metric(`${starPts}pts`)} surge that tilts the early board.`
    : ` Until projections firm up, both desks should treat their top projected position weapon as the swing piece that decides the card.`;

  const slateLines =
    pairs.length > 0
      ? pairs
          .slice(0, 3)
          .map(
            (p) =>
              `${nameToken(p.home || UNNAMED_FRANCHISE)} (${metric(`${pts2(p.homeProj)}pts`)} projected) against ${nameToken(p.away || UNNAMED_FRANCHISE)} (${metric(`${pts2(p.awayProj)}pts`)} projected)`,
          )
          .join("; ")
      : `${nameToken(spotlightA)} and ${nameToken(spotlightB)} headline an unsettled slate`;

  return {
    title: `MATCHUP PREVIEW: ${spotlightA.toUpperCase()} AND ${spotlightB.toUpperCase()} SET THE TONE FOR WEEK ${brief.week + 1}`,
    paragraphs: [
      `The Press Room turns its attention to the next slate, where projected totals already paint a clear hierarchy. Early board math has ${nameToken(spotlightA)} checking in near ${metric(`${projA}pts`)}, while ${nameToken(spotlightB)} sits closer to ${metric(`${projB}pts`)} — a gap that will force both desks into aggressive start-sit decisions.${starClause}`,
      `Across the league, the featured card list includes ${slateLines}. Managers chasing Apex Performance form must weigh boom-bust upside against floor reliability, especially after last week's razor-thin outcomes rewrote the standings narrative.`,
      `Keep an eye on coaching efficiency early. The clubs that treated Gridiron Genius as a weekly habit — not a one-off — enter the preview window with cleaner benches and sharper flex calls. The managers who sleep on the wire now will be writing excuses later.`,
    ],
  };
}

function generateWaiverArticle(brief: EditorialBrief): GeneratedArticle {
  const gemName = brief.waiverPlayer.trim() || "a featured playmaker";
  const gemTeam = brief.waiverTeam.trim() || UNNAMED_FRANCHISE;
  const gemPts = pts2(brief.waiverPoints);
  const stalled = brief.stalledTeam.trim() || UNNAMED_FRANCHISE;
  const apex = brief.apexTeam.trim() || UNNAMED_FRANCHISE;
  const gemPlayer: BriefPlayer | null =
    brief.waiverPlayerId && brief.waiverPlayer
      ? {
          id: brief.waiverPlayerId,
          name: brief.waiverPlayer,
          points: brief.waiverPoints,
          rosterId: null,
          teamName: gemTeam,
        }
      : null;
  const mvp = brief.mvpPlayer;

  const gemLead = gemPlayer ? playerToken(gemPlayer) : nameToken(gemName);
  const mvpAside = mvp
    ? ` Even Apex Performance clubs chasing ${playerToken(mvp)} form should treat the wire as a weekly habit, not a panic button.`
    : ` Even Apex Performance clubs should treat the wire as a weekly habit, not a panic button.`;

  return {
    title: `WAIVER SWEEP: ${gemName.toUpperCase()} HIGHLIGHTS THE PRIORITY BOARD AFTER WEEK ${brief.week}`,
    paragraphs: [
      `The waiver wire never sleeps, and this week's priority list starts with ${gemLead}. After posting ${metric(`${gemPts}pts`)} for ${nameToken(gemTeam)}, the Press Room is treating that claim as the blueprint for opportunistic adds — not a one-week fluke.`,
      `${nameToken(stalled)} and other clubs near the bottom of the scoring pile need volume and upside more than comfort. Meanwhile, ${nameToken(apex)} can afford surgical adds that protect Apex Performance form without blowing up a locked lineup core.${mvpAside}`,
      `Expect the next processing window to get noisy. Managers who wait for the headline names will miss the secondary pieces that decide Razor's Edge outcomes. Move early, stream smart, and keep the Gridiron Genius efficiency board clean heading into the next kickoff slate.`,
    ],
  };
}

type RosterPlayerPts = { pos: string; points: number; playerId: string };

function normalizePos(pos: string): string {
  const p = pos.trim().toUpperCase();
  if (p === "DST" || p === "D/ST" || p === "DEFENSE") return "DEF";
  return p;
}

function takeTopPoints(rows: RosterPlayerPts[], count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i += 1) sum += rows[i]?.points ?? 0;
  return sum;
}

function coachingEfficiency(
  rosterPlayers: RosterPlayerPts[],
  scoredPoints: number,
  rosterPositions: string[],
): number | null {
  if (!rosterPlayers.length || scoredPoints <= 0) return null;
  const req = starterRequirements(rosterPositions);
  const qbSlots = Math.max(1, req["QB"] ?? 1);
  const rbSlots = Math.max(1, req["RB"] ?? 2);
  const wrSlots = Math.max(1, req["WR"] ?? 2);
  const teSlots = Math.max(1, req["TE"] ?? 1);
  const flexSlots = Math.max(0, req["FLEX"] ?? 1);
  const defSlots = Math.max(1, req["DEF"] ?? 1);
  const kSlots = Math.max(1, req["K"] ?? 1);

  const byPos = (pos: string) =>
    rosterPlayers.filter((p) => p.pos === pos).sort((a, b) => b.points - a.points);

  const qbs = byPos("QB");
  const rbs = byPos("RB");
  const wrs = byPos("WR");
  const tes = byPos("TE");
  const defs = byPos("DEF");
  const ks = byPos("K");

  const remainingFlex = [...rbs.slice(rbSlots), ...wrs.slice(wrSlots), ...tes.slice(teSlots)].sort(
    (a, b) => b.points - a.points,
  );

  const optimal =
    takeTopPoints(qbs, qbSlots) +
    takeTopPoints(rbs, rbSlots) +
    takeTopPoints(wrs, wrSlots) +
    takeTopPoints(tes, teSlots) +
    takeTopPoints(remainingFlex, flexSlots) +
    takeTopPoints(defs, defSlots) +
    takeTopPoints(ks, kSlots);

  if (optimal <= 0) return null;
  return Math.min(100, (scoredPoints / optimal) * 100);
}

type AwardRow = {
  id: string;
  title: string;
  /** Identity woven into the lead of the narrative sentence. */
  leadName: string;
  /** Continuations after leadName (no duplicated identity). */
  sentence: string;
  rosterId: number | null;
  teamName: string;
  owner: string;
  logo: string | null;
  playerId?: string | null;
  player?: Player | null;
};

function teamInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "TM";
  const letters = cleaned.replace(/[^a-zA-Z0-9]/g, "");
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

function PressRoomTeamAvatar({
  name,
  logo,
  platform,
}: {
  name: string;
  logo?: string | null;
  platform?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const src = resolveAvatarUrl(logo);
  const plat = (platform ?? "").trim().toLowerCase();

  useEffect(() => {
    setFailed(false);
  }, [src, plat]);

  const shell =
    "relative flex h-14 w-14 flex-shrink-0 select-none items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm";

  if (src && !failed) {
    return (
      <span className={shell}>
        <img
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
      <span className={shell}>
        <img src="/espn.png" alt="ESPN" className="h-8 w-8 object-contain" aria-hidden="true" />
      </span>
    );
  }

  return <span className={shell}>{teamInitials(name)}</span>;
}

function AwardCard({
  award,
  platform,
  onOpenPlayer,
  onOpenTeam,
}: {
  award: AwardRow;
  platform: string | null;
  onOpenPlayer: (id: string) => void;
  onOpenTeam: (rosterId: number) => void;
}) {
  const openLead = () => {
    if (award.playerId) {
      onOpenPlayer(award.playerId);
      return;
    }
    if (award.rosterId != null) onOpenTeam(award.rosterId);
  };

  return (
    <div className="flex items-center space-x-4 rounded-xl border border-slate-100 bg-white p-4 text-left shadow-sm">
      {award.player ? (
        <button
          type="button"
          className="relative h-14 w-14 flex-shrink-0 cursor-pointer select-none overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          onClick={() => onOpenPlayer(award.player!.id)}
          aria-label={`Open ${award.player.name}`}
        >
          <PlayerAvatar
            id={award.player.id}
            pos={(award.player.pos || "WR") as Pos}
            team={award.player.team || ""}
            name={award.player.name}
            className="size-14"
            logoClassName="size-5"
          />
        </button>
      ) : (
        <button
          type="button"
          className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          onClick={openLead}
          aria-label={`Open ${award.teamName}`}
        >
          <PressRoomTeamAvatar name={award.teamName} logo={award.logo} platform={platform} />
        </button>
      )}
      <div className="min-w-0 flex-1 select-none pr-4 text-left">
        <span className="mb-2 block text-left text-xs font-black uppercase tracking-widest text-slate-900">
          {award.title}
        </span>
        <p className="text-left text-sm font-bold leading-relaxed text-slate-600">
          <button
            type="button"
            onClick={openLead}
            className="mr-1.5 cursor-pointer font-black text-slate-900 transition-colors hover:text-blue-600 hover:underline"
          >
            {award.leadName}
          </button>
          {renderSentence(award.sentence)}
        </p>
      </div>
    </div>
  );
}

function PressRoomPage() {
  const { activeLeague } = useActiveLeague();
  const platform = activeLeague?.platform ?? null;
  const { data: playersPayload } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const playersByName = useMemo(() => {
    const map = new Map<string, Player>();
    const sanitize = (value: string) =>
      value
        .toLowerCase()
        .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
        .replace(/[^a-z0-9]/g, "")
        .trim();
    const defenseKey = (raw: string) => {
      const cleaned = raw
        .toLowerCase()
        .replace(/d\s*\/?\s*st|dst|defense|special teams/g, " ")
        .trim();
      const parts = cleaned.split(/\s+/).filter(Boolean);
      return parts.length ? sanitize(parts[parts.length - 1]!) : "";
    };
    for (const p of players) {
      const key = sanitize(p.name);
      if (key && !map.has(key)) map.set(key, p);
      if (p.pos === "DEF") {
        const defKey = defenseKey(p.name);
        if (defKey && !map.has(defKey)) map.set(defKey, p);
        const teamKey = sanitize(p.team);
        if (teamKey && !map.has(teamKey)) map.set(teamKey, p);
      }
    }
    return map;
  }, [players]);
  const { teams, rosterPositions } = useLeagueRosters(players);
  const { events } = useLeagueActivity();
  const modalRef = useRef<PlayerModalHandle>(null);

  const nflWeek = useQuery({
    queryKey: ["nfl-state-week"],
    staleTime: 30 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const res = await fetch("https://api.sleeper.app/v1/state/nfl", {
        headers: { accept: "application/json" },
      }).catch(() => null);
      const json = res && res.ok ? ((await res.json()) as Record<string, unknown>) : null;
      return Math.max(1, Number(json?.["week"] ?? 1) || 1);
    },
  });

  const currentWeek = nflWeek.data ?? null;
  const finalizedWeeks = useMemo(() => {
    if (currentWeek == null) return [1];
    if (currentWeek <= 1) return [1];
    return Array.from({ length: currentWeek - 1 }, (_, i) => i + 1);
  }, [currentWeek]);

  const defaultWeek = finalizedWeeks[finalizedWeeks.length - 1] ?? 1;
  const [selectedWeek, setSelectedWeek] = useState<number>(defaultWeek);
  const [articleTab, setArticleTab] = useState<ArticleTab>("recap");

  useEffect(() => {
    setSelectedWeek(defaultWeek);
  }, [defaultWeek, activeLeague?.id]);

  const { matchups, loading: matchupsLoading } = useActiveMatchups(selectedWeek);
  const { matchups: previewMatchups } = useActiveMatchups(selectedWeek + 1);

  const logoBySlot = useMemo(() => {
    const map = new Map<number, string | null>();
    for (const team of teams) map.set(team.slot, team.logo);
    return map;
  }, [teams]);

  const weekReport = useMemo(() => {
    const emptyBrief: EditorialBrief = {
      week: selectedWeek,
      apexTeam: "",
      apexPoints: 0,
      apexLogo: null,
      stalledTeam: "",
      stalledPoints: 0,
      woodshedWinner: "",
      woodshedLoser: "",
      woodshedMargin: 0,
      razorWinner: "",
      razorLoser: "",
      razorMargin: 0,
      geniusTeam: "",
      geniusEfficiency: 0,
      waiverPlayer: "",
      waiverTeam: "",
      waiverPoints: 0,
      waiverLogo: null,
      waiverPlayerId: null,
      previewFocusTeam: "",
      previewFocusLogo: null,
      mvpPlayer: null,
      benchBustPlayer: null,
      benchBustNarrative: null,
      previewStarPlayer: null,
      previewPairs: [],
    };

    const entries = matchups?.entries ?? [];
    if (entries.length < 2) {
      return {
        awards: [] as AwardRow[],
        brief: emptyBrief,
      };
    }

    const scored = [...entries].sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0));
    const high = scored[0]!;
    const low = scored[scored.length - 1]!;

    const pairs: {
      winner: (typeof entries)[0];
      loser: (typeof entries)[0];
      margin: number;
    }[] = [];

    const byMatchup = new Map<number, typeof entries>();
    for (const entry of entries) {
      if (entry.matchupId == null) continue;
      const bucket = byMatchup.get(entry.matchupId) ?? [];
      bucket.push(entry);
      byMatchup.set(entry.matchupId, bucket);
    }

    for (const pair of byMatchup.values()) {
      if (pair.length !== 2) continue;
      const [a, b] = pair;
      if (!a || !b) continue;
      const aPts = Number(a.points) || 0;
      const bPts = Number(b.points) || 0;
      if (aPts === bPts) continue;
      const winner = aPts > bPts ? a : b;
      const loser = aPts > bPts ? b : a;
      pairs.push({
        winner,
        loser,
        margin: Math.abs(aPts - bPts),
      });
    }

    const blowout = [...pairs].sort((a, b) => b.margin - a.margin)[0] ?? null;
    const badBeat = [...pairs].sort((a, b) => a.margin - b.margin)[0] ?? null;

    const winners = pairs.map((p) => p.winner);
    const losers = pairs.map((p) => p.loser);
    const luckyBreak =
      winners.length > 0
        ? [...winners].sort((a, b) => (Number(a.points) || 0) - (Number(b.points) || 0))[0]!
        : null;
    const notSoLucky =
      losers.length > 0
        ? [...losers].sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0))[0]!
        : null;

    let managerOfWeek: {
      entry: (typeof entries)[0];
      efficiency: number;
    } | null = null;

    for (const entry of entries) {
      const rosterPlayers: RosterPlayerPts[] = Object.entries(entry.playerPoints ?? {}).map(
        ([id, pts]) => {
          const player = playersById.get(id);
          return {
            playerId: id,
            pos: normalizePos(player?.pos ?? ""),
            points: Number(pts) || 0,
          };
        },
      );
      const efficiency = coachingEfficiency(
        rosterPlayers,
        Number(entry.points) || 0,
        rosterPositions,
      );
      if (efficiency == null) continue;
      if (!managerOfWeek || efficiency > managerOfWeek.efficiency) {
        managerOfWeek = { entry, efficiency };
      }
    }

    const waiverAddIds = new Set<string>();
    for (const event of events) {
      if (event.kind !== "waiver" && event.kind !== "free_agent") continue;
      for (const move of event.moves ?? []) {
        if (move.action !== "add" || !move.playerId) continue;
        // Map ESPN ids / ghost labels onto the Sleeper catalog before matching
        // boxscore playerPoints (which now use Sleeper anchors).
        const hydrated = hydrateActivityMove(move, playersById, playersByName);
        waiverAddIds.add(String(hydrated.playerId));
        if (hydrated.name) {
          const byName = playersByName.get(
            hydrated.name
              .toLowerCase()
              .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
              .replace(/[^a-z0-9]/g, "")
              .trim(),
          );
          if (byName) waiverAddIds.add(byName.id);
        }
      }
    }

    let waiverGem: {
      player: Player;
      points: number;
      teamName: string;
      owner: string;
      logo: string | null;
    } | null = null;

    for (const entry of entries) {
      // Prefer started adds; when ESPN lineup slots are missing, fall back to
      // any scored rostered waiver add so the article still features a real gem.
      const starterIds = new Set((entry.starters ?? []).map(String).filter(Boolean));
      const rosteredIds = new Set<string>([
        ...starterIds,
        ...(entry.playerIds ?? []).map(String).filter(Boolean),
        ...Object.keys(entry.playerPoints ?? {}),
      ]);
      if (rosteredIds.size === 0) continue;

      for (const [playerId, pts] of Object.entries(entry.playerPoints ?? {})) {
        if (!waiverAddIds.has(playerId)) continue;
        if (starterIds.size > 0 && !starterIds.has(playerId)) continue;
        if (starterIds.size === 0 && !rosteredIds.has(playerId)) continue;
        const player = playersById.get(playerId);
        if (!player) continue;
        const points = Number(pts) || 0;
        if (!waiverGem || points > waiverGem.points) {
          waiverGem = {
            player,
            points,
            teamName: entry.teamName,
            owner: entry.owner,
            logo: entry.logo ?? logoBySlot.get(entry.rosterId) ?? null,
          };
        }
      }
    }

    // Last resort: activity add currently on a league roster (no week points yet).
    if (!waiverGem && waiverAddIds.size && teams.length) {
      for (const team of teams) {
        for (const player of team.players ?? []) {
          if (!waiverAddIds.has(player.id)) continue;
          waiverGem = {
            player,
            points: 0,
            teamName: team.team,
            owner: team.owner,
            logo: team.logo ?? logoBySlot.get(team.slot) ?? null,
          };
          break;
        }
        if (waiverGem) break;
      }
    }

    const previewPairs: EditorialBrief["previewPairs"] = [];
    const previewEntries = previewMatchups?.entries ?? [];
    const previewByMatchup = new Map<number, typeof previewEntries>();
    for (const entry of previewEntries) {
      if (entry.matchupId == null) continue;
      const bucket = previewByMatchup.get(entry.matchupId) ?? [];
      bucket.push(entry);
      previewByMatchup.set(entry.matchupId, bucket);
    }
    for (const pair of previewByMatchup.values()) {
      if (pair.length !== 2) continue;
      const [a, b] = pair;
      if (!a || !b) continue;
      previewPairs.push({
        home: a.teamName,
        away: b.teamName,
        homeProj: Number(a.projectedPoints) || Number(a.points) || 0,
        awayProj: Number(b.projectedPoints) || Number(b.points) || 0,
        homeLogo: a.logo ?? logoBySlot.get(a.rosterId) ?? null,
        awayLogo: b.logo ?? logoBySlot.get(b.rosterId) ?? null,
      });
    }
    previewPairs.sort(
      (x, y) => Math.max(y.homeProj, y.awayProj) - Math.max(x.homeProj, x.awayProj),
    );

    const previewFocusPair = previewPairs[0] ?? null;
    const previewFocusTeam = previewFocusPair?.away || previewFocusPair?.home || "";
    const previewFocusLogo =
      previewFocusPair?.awayLogo ?? previewFocusPair?.homeLogo ?? null;

    /** Verified fantasy ownership from leagueRosters (player id → club). */
    const rosterOwnership = buildRosterOwnership(teams);

    /** Build scored player rows tagged by verified roster ownership + starter / bench. */
    type LineupTaggedPlayer = BriefPlayer & {
      isStarter: boolean;
      hasLineup: boolean;
    };
    const playersPool: LineupTaggedPlayer[] = [];

    for (const entry of entries) {
      const starterIds = (entry.starters ?? []).map(String).filter(Boolean);
      const starterSet = new Set(starterIds);
      const hasLineup = starterSet.size > 0;
      for (const [playerId, pts] of Object.entries(entry.playerPoints ?? {})) {
        const player = playersById.get(playerId);
        if (!player?.name) continue;
        const rosterId = getTrueRosterId(playerId, rosterOwnership, entry.rosterId);
        const teamName = getTrueRosterName(playerId, rosterOwnership, entry.teamName);
        const isStarter = hasLineup && starterSet.has(playerId);
        playersPool.push({
          id: playerId,
          name: player.name,
          points: Number(pts) || 0,
          rosterId,
          teamName,
          isStarter,
          hasLineup,
        });
      }
    }

    // Isolate the highest scoring STARTER on the apex team's verified roster only.
    const apexRosterId = high.rosterId;
    const topTeamPlayers = playersPool.filter(
      (p) => p.rosterId != null && p.rosterId === apexRosterId,
    );
    const topTeamStarters = topTeamPlayers.filter((p) => p.hasLineup && p.isStarter);
    const teamMvpPlayer =
      [...topTeamStarters].sort((a, b) => b.points - a.points)[0] ?? null;

    // Highest confirmed bench explosion — outcome judged against THAT player's true club.
    const benchPlayers = playersPool.filter((p) => p.hasLineup && !p.isStarter);
    const topBenchExplosion =
      [...benchPlayers].sort((a, b) => b.points - a.points)[0] ?? null;

    const toBriefPlayer = (p: LineupTaggedPlayer | null): BriefPlayer | null =>
      p
        ? {
            id: p.id,
            name: p.name,
            points: p.points,
            rosterId: p.rosterId,
            teamName: p.teamName || UNNAMED_FRANCHISE,
          }
        : null;

    const mvpPlayer = toBriefPlayer(teamMvpPlayer);

    let benchBustPlayer: BriefPlayer | null = null;
    let benchBustNarrative: EditorialBrief["benchBustNarrative"] = null;

    if (topBenchExplosion?.rosterId != null) {
      const benchRosterId = topBenchExplosion.rosterId;
      const benchPair = pairs.find(
        (p) => p.winner.rosterId === benchRosterId || p.loser.rosterId === benchRosterId,
      );
      if (benchPair) {
        const wonAnyway = benchPair.winner.rosterId === benchRosterId;
        if (wonAnyway) {
          benchBustPlayer = toBriefPlayer(topBenchExplosion);
          benchBustNarrative = "won_anyway";
        } else if (benchPair.margin < topBenchExplosion.points) {
          benchBustPlayer = toBriefPlayer(topBenchExplosion);
          benchBustNarrative = "cost_matchup";
        }
      }
    }

    /** Preview focus club's top STARTED weapon, ownership-verified. */
    const resolveTopStartedPlayerOnTeam = (
      teamName: string,
      rosterIdHint?: number | null,
    ): BriefPlayer | null => {
      const hintId =
        rosterIdHint ??
        entries.find((e) => e.teamName === teamName)?.rosterId ??
        teams.find((t) => t.team === teamName)?.slot ??
        null;
      const pool = playersPool.filter((p) => {
        if (!p.hasLineup || !p.isStarter) return false;
        if (hintId != null && p.rosterId === hintId) return true;
        return Boolean(teamName) && p.teamName === teamName;
      });
      const best = [...pool].sort((a, b) => b.points - a.points)[0] ?? null;
      return toBriefPlayer(best);
    };

    const previewFocusRosterId =
      previewEntries.find((e) => e.teamName === previewFocusTeam)?.rosterId ??
      teams.find((t) => t.team === previewFocusTeam)?.slot ??
      null;

    const previewStarPlayer =
      resolveTopStartedPlayerOnTeam(previewFocusTeam, previewFocusRosterId) ||
      resolveTopStartedPlayerOnTeam(high.teamName, high.rosterId) ||
      mvpPlayer;

    const brief: EditorialBrief = {
      week: selectedWeek,
      apexTeam: high.teamName || UNNAMED_FRANCHISE,
      apexPoints: Number(high.points) || 0,
      apexLogo: high.logo ?? logoBySlot.get(high.rosterId) ?? null,
      stalledTeam: low.teamName || UNNAMED_FRANCHISE,
      stalledPoints: Number(low.points) || 0,
      woodshedWinner: blowout?.winner.teamName ?? "",
      woodshedLoser: blowout?.loser.teamName ?? "",
      woodshedMargin: blowout?.margin ?? 0,
      razorWinner: badBeat?.winner.teamName ?? "",
      razorLoser: badBeat?.loser.teamName ?? "",
      razorMargin: badBeat?.margin ?? 0,
      geniusTeam: managerOfWeek?.entry.teamName ?? "",
      geniusEfficiency: managerOfWeek?.efficiency ?? 0,
      waiverPlayer: waiverGem?.player.name ?? "",
      waiverTeam:
        (waiverGem
          ? getTrueRosterName(
              waiverGem.player.id,
              rosterOwnership,
              waiverGem.teamName,
            )
          : "") || "",
      waiverPoints: waiverGem?.points ?? 0,
      waiverLogo: waiverGem?.logo ?? null,
      waiverPlayerId: waiverGem?.player.id ?? null,
      previewFocusTeam,
      previewFocusLogo,
      mvpPlayer,
      benchBustPlayer,
      benchBustNarrative,
      previewStarPlayer,
      previewPairs,
    };

    const awards: AwardRow[] = [
      {
        id: "high-score",
        title: "Apex Performance",
        leadName: high.teamName,
        sentence: fillPhrase(pickPhrase(HIGH_SCORE_LINES, `${selectedWeek}:high:${high.rosterId}`), {
          PTS: metric(`${pts2(Number(high.points) || 0)}pts`),
          TEAM: high.teamName,
        }),
        rosterId: high.rosterId,
        teamName: high.teamName,
        owner: high.owner,
        logo: high.logo ?? logoBySlot.get(high.rosterId) ?? null,
      },
      {
        id: "bottom",
        title: "Stalled Out",
        leadName: low.teamName,
        sentence: fillPhrase(
          pickPhrase(BOTTOM_OF_THE_PILE_LINES, `${selectedWeek}:bottom:${low.rosterId}`),
          {
            PTS: metric(`${pts2(Number(low.points) || 0)}pts`),
            TEAM: low.teamName,
          },
        ),
        rosterId: low.rosterId,
        teamName: low.teamName,
        owner: low.owner,
        logo: low.logo ?? logoBySlot.get(low.rosterId) ?? null,
      },
    ];

    if (blowout) {
      awards.push({
        id: "bragging",
        title: "The Woodshed Award",
        leadName: blowout.winner.teamName,
        sentence: fillPhrase(
          pickPhrase(BRAGGING_RIGHTS_LINES, `${selectedWeek}:brag:${blowout.winner.rosterId}`),
          {
            WINNER: blowout.winner.teamName,
            LOSER: blowout.loser.teamName,
            MARGIN: metric(`${pts2(blowout.margin)}pts`),
            W_PTS: metric(`${pts2(Number(blowout.winner.points) || 0)}pts`),
            L_PTS: metric(`${pts2(Number(blowout.loser.points) || 0)}pts`),
          },
        ),
        rosterId: blowout.winner.rosterId,
        teamName: blowout.winner.teamName,
        owner: blowout.winner.owner,
        logo: blowout.winner.logo ?? logoBySlot.get(blowout.winner.rosterId) ?? null,
      });
    }

    if (badBeat) {
      awards.push({
        id: "bad-beat",
        title: "Razor's Edge",
        leadName: badBeat.loser.teamName,
        sentence: fillPhrase(
          pickPhrase(BAD_BEAT_LINES, `${selectedWeek}:badbeat:${badBeat.loser.rosterId}`),
          {
            WINNER: badBeat.winner.teamName,
            LOSER: badBeat.loser.teamName,
            MARGIN: metric(`${pts2(Number(badBeat.margin))}pts`),
          },
        ),
        rosterId: badBeat.loser.rosterId,
        teamName: badBeat.loser.teamName,
        owner: badBeat.loser.owner,
        logo: badBeat.loser.logo ?? logoBySlot.get(badBeat.loser.rosterId) ?? null,
      });
    }

    if (luckyBreak) {
      const luckyPair =
        pairs.find((p) => Number(p.winner.rosterId) === Number(luckyBreak.rosterId)) ?? null;
      awards.push({
        id: "lucky",
        title: "Houdini Act",
        leadName: luckyBreak.teamName,
        sentence: fillPhrase(
          pickPhrase(LUCKY_BREAK_LINES, `${selectedWeek}:lucky:${luckyBreak.rosterId}`),
          {
            WINNER: luckyBreak.teamName,
            LOSER: luckyPair?.loser.teamName ?? "their opponent",
            PTS: metric(`${pts2(Number(luckyBreak.points) || 0)}pts`),
          },
        ),
        rosterId: luckyBreak.rosterId,
        teamName: luckyBreak.teamName,
        owner: luckyBreak.owner,
        logo: luckyBreak.logo ?? logoBySlot.get(luckyBreak.rosterId) ?? null,
      });
    }

    if (notSoLucky) {
      const nslPair =
        pairs.find((p) => Number(p.loser.rosterId) === Number(notSoLucky.rosterId)) ?? null;
      awards.push({
        id: "not-lucky",
        title: "Tough Pill to Swallow",
        leadName: notSoLucky.teamName,
        sentence: fillPhrase(
          pickPhrase(NOT_SO_LUCKY_LINES, `${selectedWeek}:nsl:${notSoLucky.rosterId}`),
          {
            LOSER: notSoLucky.teamName,
            WINNER: nslPair?.winner.teamName ?? "their opponent",
            PTS: metric(`${pts2(Number(notSoLucky.points) || 0)}pts`),
          },
        ),
        rosterId: notSoLucky.rosterId,
        teamName: notSoLucky.teamName,
        owner: notSoLucky.owner,
        logo: notSoLucky.logo ?? logoBySlot.get(notSoLucky.rosterId) ?? null,
      });
    }

    if (managerOfWeek) {
      awards.push({
        id: "motw",
        title: "Gridiron Genius",
        leadName: managerOfWeek.entry.teamName,
        sentence: fillPhrase(
          pickPhrase(
            MANAGER_OF_THE_WEEK_LINES,
            `${selectedWeek}:motw:${managerOfWeek.entry.rosterId}`,
          ),
          {
            TEAM: managerOfWeek.entry.teamName,
            EFF: metric(`${eff1(managerOfWeek.efficiency)}%`),
          },
        ),
        rosterId: managerOfWeek.entry.rosterId,
        teamName: managerOfWeek.entry.teamName,
        owner: managerOfWeek.entry.owner,
        logo:
          managerOfWeek.entry.logo ??
          logoBySlot.get(managerOfWeek.entry.rosterId) ??
          null,
      });
    }

    if (waiverGem) {
      const gemRoster =
        entries.find((e) => e.teamName === waiverGem.teamName)?.rosterId ??
        teams.find((t) => t.team === waiverGem.teamName)?.slot ??
        null;
      awards.push({
        id: "waiver-gem",
        title: "Waiver Wire Gem",
        leadName: waiverGem.player.name,
        sentence: fillPhrase(
          pickPhrase(WAIVER_WIRE_GEM_LINES, `${selectedWeek}:gem:${waiverGem.player.id}`),
          {
            PLAYER: waiverGem.player.name,
            TEAM: waiverGem.teamName,
            PTS: metric(`${pts2(waiverGem.points)}pts`),
          },
        ),
        rosterId: gemRoster,
        teamName: waiverGem.teamName,
        owner: waiverGem.owner,
        logo: waiverGem.logo,
        playerId: waiverGem.player.id,
        player: waiverGem.player,
      });
    }

    return {
      awards,
      brief,
    };
  }, [
    matchups,
    previewMatchups,
    playersById,
    playersByName,
    rosterPositions,
    events,
    logoBySlot,
    selectedWeek,
    teams,
  ]);

  const articles = useMemo(() => {
    const brief = weekReport.brief;
    return {
      recap: generateRecapArticle(brief),
      preview: generatePreviewArticle(brief),
      waiver: generateWaiverArticle(brief),
    };
  }, [weekReport.brief]);

  const activeArticle =
    articleTab === "recap"
      ? articles.recap
      : articleTab === "preview"
        ? articles.preview
        : articles.waiver;

  const navigate = useNavigate();
  const openPlayer = (id: string) => modalRef.current?.open(id);
  const openTeam = (rosterId: number) => {
    void navigate({
      to: "/playbook/rosters",
      search: { scout: String(rosterId) },
    });
  };

  const articleBackgroundSrc = getArticleBackgroundImage(articleTab);

  const bannerTeamName =
    articleTab === "preview"
      ? weekReport.brief.previewFocusTeam || weekReport.brief.apexTeam
      : articleTab === "waiver"
        ? weekReport.brief.waiverTeam || weekReport.brief.apexTeam
        : weekReport.brief.apexTeam;
  const bannerLogoRaw =
    articleTab === "preview"
      ? weekReport.brief.previewFocusLogo || weekReport.brief.apexLogo
      : articleTab === "waiver"
        ? weekReport.brief.waiverLogo || weekReport.brief.apexLogo
        : weekReport.brief.apexLogo;
  const bannerLogoSrc = resolveAvatarUrl(bannerLogoRaw);

  const deskEyebrow =
    articleTab === "recap"
      ? "Editorial Debrief"
      : articleTab === "preview"
        ? "Matchup Intel"
        : "Wire Scout";

  return (
    <div className="w-full">
      <div className="mb-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="display-title text-lg font-bold uppercase tracking-wide text-slate-900">
            Press Room
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Weekly league journalism, awards, and headline performances.
          </p>
        </div>
        <div className="w-full max-w-[11rem] shrink-0">
          <Select
            value={String(selectedWeek)}
            onValueChange={(value) => setSelectedWeek(Math.max(1, Number(value) || 1))}
          >
            <SelectTrigger className="h-9 border-slate-200 bg-white text-sm font-semibold text-slate-800">
              <SelectValue placeholder="Select week" />
            </SelectTrigger>
            <SelectContent>
              {finalizedWeeks.map((week) => (
                <SelectItem key={week} value={String(week)}>
                  Week {week}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-4 grid w-full grid-cols-1 gap-6 select-none lg:grid-cols-3">
        <div className="flex min-h-[500px] flex-col items-start rounded-2xl border border-slate-100 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="mb-5 flex w-full flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-100 pb-1">
            {ARTICLE_TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setArticleTab(item.id)}
                className={cn(
                  "shrink-0 text-xs font-black uppercase tracking-wider transition-colors",
                  articleTab === item.id
                    ? "border-b-2 border-blue-600 pb-2.5 text-blue-600"
                    : "pb-2.5 text-slate-400 hover:text-slate-700",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="group relative mb-6 h-[180px] w-full select-none overflow-hidden rounded-xl border border-slate-100/50 bg-slate-900 shadow-xs">
            <img
              src={articleBackgroundSrc}
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-35 blur-[1px] transition-transform duration-700 group-hover:scale-105"
            />
            <div
              className="pointer-events-none absolute inset-0 opacity-15 mix-blend-color"
              style={{
                backgroundColor: fantasyBrandColor(bannerTeamName || "League"),
              }}
            />
            {bannerLogoSrc ? (
              <img
                src={bannerLogoSrc}
                alt=""
                className="pointer-events-none absolute right-5 top-1/2 h-24 w-24 -translate-y-1/2 rounded-full border border-white/30 object-cover opacity-90 shadow-lg"
              />
            ) : null}
            <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-slate-950 via-slate-950/40 to-slate-950/20 p-5 text-left">
              <span className="mb-1 text-[9px] font-black uppercase tracking-widest text-blue-400">
                {deskEyebrow}
              </span>
              <h2 className="max-w-2xl font-sans text-xl font-black uppercase leading-tight tracking-tight text-white drop-shadow-md">
                {activeArticle.title}
              </h2>
            </div>
          </div>

          <article className="w-full text-left">
            {matchupsLoading && !weekReport.brief.apexTeam ? (
              <p className="text-sm text-muted-foreground">Loading editorial desk…</p>
            ) : (
              <div className="space-y-5">
                {activeArticle.paragraphs.map((paragraph, index) => (
                  <p
                    key={`${articleTab}-${index}`}
                    className="text-base font-medium leading-relaxed text-slate-600 sm:text-[1.05rem]"
                  >
                    {renderSentence(paragraph, openPlayer)}
                  </p>
                ))}
              </div>
            )}
          </article>
        </div>

        <div className="flex flex-col space-y-3 lg:col-span-1">
          <h2 className="display-title text-sm font-bold uppercase tracking-wide text-slate-900">
            Weekly Awards
          </h2>
          {matchupsLoading && weekReport.awards.length === 0 ? (
            <div className={cn(playbookCardClass, "p-4")}>
              <p className="text-sm text-muted-foreground">Compiling awards desk…</p>
            </div>
          ) : weekReport.awards.length === 0 ? (
            <div className={cn(playbookCardClass, "p-4")}>
              <p className="text-sm text-muted-foreground">
                Awards appear once this week has completed matchup results.
              </p>
            </div>
          ) : (
            weekReport.awards.map((award) => (
              <AwardCard
                key={award.id}
                award={award}
                platform={platform}
                onOpenPlayer={openPlayer}
                onOpenTeam={openTeam}
              />
            ))
          )}
        </div>
      </div>

      <PlayerModalHost ref={modalRef} />
    </div>
  );
}
