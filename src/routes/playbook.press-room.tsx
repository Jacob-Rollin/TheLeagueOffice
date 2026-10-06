import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import {
  playbookCardClass,
  playbookPanelTitleClass,
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
import { useActiveStandings } from "@/hooks/useActiveStandings";
import { useLeagueActivity } from "@/hooks/useLeagueActivity";
import { useNflState } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Player, Pos } from "@/lib/draft";
import { completedWeekNumberList, standingsGamesPlayed } from "@/lib/completed-weeks";
import { cn } from "@/lib/utils";
import {
  buildPlayersByName,
  buildWeekReport,
  eff1,
  metric,
  nameToken,
  pts2,
  UNNAMED_FRANCHISE,
  type AwardRow,
  type BriefPlayer,
  type EditorialBrief,
} from "@/lib/weekly-awards";

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
  const playersByName = useMemo(() => buildPlayersByName(players), [players]);
  const { teams, rosterPositions } = useLeagueRosters(players);
  const { standings } = useActiveStandings();
  const { events } = useLeagueActivity();
  const modalRef = useRef<PlayerModalHandle>(null);

  const nflWeek = useNflState();
  const currentWeek = nflWeek.data?.week ?? null;
  const displayWeek = nflWeek.data?.displayWeek ?? null;
  const finalizedWeeks = useMemo(() => {
    const weeks = completedWeekNumberList({
      nflWeek: currentWeek,
      displayWeek,
      gamesPlayed: standingsGamesPlayed(standings?.rows),
    });
    return weeks.length ? weeks : [1];
  }, [currentWeek, displayWeek, standings?.rows]);

  const defaultWeek = finalizedWeeks[finalizedWeeks.length - 1] ?? 1;
  const [selectedWeek, setSelectedWeek] = useState<number>(defaultWeek);
  const [articleTab, setArticleTab] = useState<ArticleTab>("recap");

  useEffect(() => {
    setSelectedWeek(defaultWeek);
  }, [defaultWeek, activeLeague?.id]);

  const { matchups, loading: matchupsLoading } = useActiveMatchups(selectedWeek);
  const { matchups: previewMatchups } = useActiveMatchups(selectedWeek + 1);

  const weekReport = useMemo(
    () =>
      buildWeekReport({
        week: selectedWeek,
        entries: matchups?.entries ?? [],
        previewEntries: previewMatchups?.entries ?? [],
        playersById,
        playersByName,
        rosterPositions,
        events,
        teams,
      }),
    [matchups, previewMatchups, playersById, playersByName, rosterPositions, events, selectedWeek, teams],
  );

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
          <h1 className="display-title text-3xl">
            Press <span className="text-primary">Room</span>
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
          <h2 className={playbookPanelTitleClass}>
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
