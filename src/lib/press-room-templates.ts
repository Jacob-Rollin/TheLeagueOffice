/**
 * Deterministic Press Room article shells — offline fallback when no LLM key /
 * generation fails validation, and for sandbox mode.
 * Uses seeded phrase banks so weeks do not always open with the same lead line.
 */
import {
  eff1,
  metric,
  nameToken,
  pickPhrase,
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

const RECAP_LEADS = [
  "The books are closed on Week [WEEK], and the league's narrative already has a clear hierarchy.",
  "Week [WEEK] delivered a full slate of box-score swings, and the desk is still sorting the wreckage.",
  "Another scoring period is in the books — Week [WEEK] left almost nobody unchanged.",
] as const;

const RECAP_TITLES = [
  "WEEK RECAP: [TOP] SETS THE PACE AS [LOSER] ABSORBS A HEARTBREAKER",
  "WEEK [WEEK] DEBRIEF: [TOP] OWNS THE BOARD WHILE [LOSER] COMES UP SHORT",
  "POST-WEEK WIRE: [TOP] IGNITES THE SCOREBOARD; [LOSER] FEELS THE RAZOR",
] as const;

const PREVIEW_LEADS = [
  "The Press Room turns to the next card, where early projections already sketch a hierarchy.",
  "Matchup week is coming into focus — the projected totals are loud enough to force start-sit decisions now.",
  "Looking ahead, the slate's early math is already picking favorites and forcing flex calls.",
] as const;

const WAIVER_LEADS = [
  "The waiver wire never sleeps, and this week's priority list starts with [GEM].",
  "After Week [WEEK], the claim board opens with [GEM] as the clear blueprint add.",
  "Wire traffic is heating up — [GEM] sits at the top of the Press Room priority stack.",
] as const;

function seed(brief: EditorialBrief, kind: PressRoomArticleKind): string {
  return `${brief.week}|${kind}|${brief.apexTeam}|${brief.razorLoser}|${brief.waiverPlayer}`;
}

export function generateRecapArticle(brief: EditorialBrief): GeneratedPressArticle {
  const topTeam = brief.apexTeam.trim() || UNNAMED_FRANCHISE;
  const lowTeam = brief.stalledTeam.trim() || UNNAMED_FRANCHISE;
  const badBeatWinner = brief.razorWinner.trim() || UNNAMED_FRANCHISE;
  const badBeatLoser = brief.razorLoser.trim() || UNNAMED_FRANCHISE;
  const margin = pts2(brief.razorMargin);
  const apexPts = pts2(brief.apexPoints);
  const stalledPts = pts2(brief.stalledPoints);
  const geniusTeam = brief.geniusTeam.trim();
  const geniusEff = brief.geniusEfficiency;
  const hasGenius = Boolean(geniusTeam) && Number.isFinite(geniusEff) && geniusEff > 0;
  const activeMvpPlayer = brief.mvpPlayer;
  const mvpPts = pts2(activeMvpPlayer?.points ?? 0);
  const s = seed(brief, "recap");

  const mvpClause = activeMvpPlayer
    ? ` The turning point came from ${playerToken(activeMvpPlayer)}, who posted ${metric(`${mvpPts}pts`)} to anchor ${nameToken(activeMvpPlayer.teamName || topTeam)}.`
    : ` The desk is still waiting on a starter to seize the clear MVP narrative.`;

  const bustClause =
    brief.benchBustPlayer && brief.benchBustNarrative
      ? generateBenchSentence(brief.benchBustPlayer, brief.benchBustNarrative)
      : ` Unused flex points on the bench remain a live threat to next week's Gridiron Genius board.`;

  const woodshedClause =
    brief.woodshedWinner && brief.woodshedLoser && brief.woodshedMargin > 0
      ? ` Meanwhile ${nameToken(brief.woodshedWinner)} put ${nameToken(brief.woodshedLoser)} on the woodshed, winning by ${metric(`${pts2(brief.woodshedMargin)}pts`)}.`
      : "";

  // Never invent Gridiron Genius at 0% — only cite when efficiency was actually measured.
  const geniusParagraph = hasGenius
    ? `${nameToken(geniusTeam)} earned Gridiron Genius honors at ${metric(`${eff1(geniusEff)}%`)} coaching efficiency. Managers who ignore that board heading into the next kickoff slate will be writing excuses later.`
    : `The Gridiron Genius board stayed unsettled this week without a clean coaching-efficiency read. Managers who treat every flex call as live ammo will be ahead of the desk next kickoff.`;

  const lead = pickPhrase(RECAP_LEADS, s).replace("[WEEK]", String(brief.week));
  const title = pickPhrase(RECAP_TITLES, `${s}|title`)
    .replace("[WEEK]", String(brief.week))
    .replace("[TOP]", topTeam.toUpperCase())
    .replace("[LOSER]", badBeatLoser.toUpperCase());

  return {
    title,
    paragraphs: [
      `${lead} Headlining the week was ${nameToken(topTeam)}, posting a week-high ${metric(`${apexPts}pts`)}.${mvpClause} On the opposite end, ${nameToken(lowTeam)} finished last with ${metric(`${stalledPts}pts`)}.${woodshedClause}`,
      `The razor drama belonged to ${nameToken(badBeatWinner)}, who edged ${nameToken(badBeatLoser)} by just ${metric(`${margin}pts`)}.${bustClause}`,
      geniusParagraph,
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
  const s = seed(brief, "preview");

  const starClause = star
    ? ` The Press Room flags ${playerToken(star)} as the early swing piece for ${nameToken(focusClub)}, riding a recent ${metric(`${starPts}pts`)} surge.`
    : ` Until projections firm up, both desks should treat their top projected weapon as the swing piece.`;

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

  const lead = pickPhrase(PREVIEW_LEADS, s);

  return {
    title: `MATCHUP PREVIEW: ${spotlightA.toUpperCase()} AND ${spotlightB.toUpperCase()} SET THE TONE FOR WEEK ${brief.week + 1}`,
    paragraphs: [
      `${lead} Early board math has ${nameToken(spotlightA)} near ${metric(`${projA}pts`)} and ${nameToken(spotlightB)} closer to ${metric(`${projB}pts`)}.${starClause}`,
      `Across the league, the featured card list includes ${slateLines}. Clubs chasing Apex Performance form must weigh boom-bust upside against floor reliability after last week's razor outcomes.`,
      `Keep coaching efficiency front of mind. The managers who treat Gridiron Genius as a weekly habit — not a one-off — enter this window with cleaner benches and sharper flex calls.`,
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
  const s = seed(brief, "waiver");

  const gemLead = gemPlayer ? playerToken(gemPlayer) : nameToken(gemName);
  const mvpAside = mvp
    ? ` Even Apex Performance clubs chasing ${playerToken(mvp)} form should treat the wire as a weekly habit, not a panic button.`
    : ` Even Apex Performance clubs should treat the wire as a weekly habit, not a panic button.`;

  const lead = pickPhrase(WAIVER_LEADS, s)
    .replace("[WEEK]", String(brief.week))
    .replace("[GEM]", gemLead);

  return {
    title: `WAIVER SWEEP: ${gemName.toUpperCase()} HIGHLIGHTS THE PRIORITY BOARD AFTER WEEK ${brief.week}`,
    paragraphs: [
      `${lead} After posting ${metric(`${gemPts}pts`)} for ${nameToken(gemTeam)}, the Press Room is treating that claim as opportunistic blueprint — not a one-week fluke.`,
      `${nameToken(stalled)} and other clubs near the bottom of the scoring pile need volume and upside more than comfort. Meanwhile, ${nameToken(apex)} can afford surgical adds that protect Apex Performance form without blowing up a locked lineup core.${mvpAside}`,
      `Expect the next processing window to get noisy. Managers who wait for the headline names will miss the secondary pieces that decide Razor's Edge outcomes. Move early, stream smart, and keep the Gridiron Genius board clean.`,
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
