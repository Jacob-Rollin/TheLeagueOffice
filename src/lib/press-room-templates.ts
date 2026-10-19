/**
 * Deterministic Press Room article shells — used as offline fallback when no
 * LLM key / generation fails validation, and for sandbox mode.
 */
import {
  eff1,
  metric,
  nameToken,
  pts2,
  UNNAMED_FRANCHISE,
  type BriefPlayer,
  type EditorialBrief,
} from "@/lib/weekly-awards";

export type PressRoomArticleKind = "recap" | "preview" | "waiver";

export type GeneratedPressArticle = {
  title: string;
  paragraphs: string[];
};

/** Wrap a player identity as a clickable modal token. */
export function playerToken(player: BriefPlayer | null | undefined, fallbackName?: string): string {
  const name = player?.name?.trim() || fallbackName?.trim() || "";
  const id = player?.id?.trim() || "";
  if (id && name) return `⟦${id}¦${name}⟧`;
  if (name) return nameToken(name);
  return nameToken("a featured playmaker");
}

/** Bench-blame copy locked to the player's true roster + that club's matchup result. */
export function generateBenchSentence(
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

export function generateRecapArticle(brief: EditorialBrief): GeneratedPressArticle {
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

export function generatePreviewArticle(brief: EditorialBrief): GeneratedPressArticle {
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

export function generateWaiverArticle(brief: EditorialBrief): GeneratedPressArticle {
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

export function generateTemplateArticle(
  kind: PressRoomArticleKind,
  brief: EditorialBrief,
): GeneratedPressArticle {
  if (kind === "preview") return generatePreviewArticle(brief);
  if (kind === "waiver") return generateWaiverArticle(brief);
  return generateRecapArticle(brief);
}
