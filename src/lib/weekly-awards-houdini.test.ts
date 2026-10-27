import { describe, expect, it } from "vitest";

import type { WeeklyMatchupEntry } from "@/lib/league.server";
import {
  buildWeekReport,
  countTeamsOutscored,
  plainSentence,
} from "@/lib/weekly-awards";

function entry(
  partial: Pick<WeeklyMatchupEntry, "rosterId" | "matchupId" | "points" | "teamName">,
): WeeklyMatchupEntry {
  return {
    rosterId: partial.rosterId,
    matchupId: partial.matchupId,
    points: partial.points,
    projectedPoints: partial.points,
    winProbabilityPct: null,
    teamName: partial.teamName,
    owner: partial.teamName,
    logo: null,
    starters: [],
    playerIds: [],
    irIds: [],
    playerPoints: {},
  };
}

describe("countTeamsOutscored", () => {
  it("counts every other club with a strictly lower weekly total", () => {
    const field = [
      entry({ rosterId: 1, matchupId: 1, points: 100, teamName: "A" }),
      entry({ rosterId: 2, matchupId: 1, points: 90, teamName: "B" }),
      entry({ rosterId: 3, matchupId: 2, points: 110, teamName: "C" }),
      entry({ rosterId: 4, matchupId: 2, points: 80, teamName: "D" }),
      entry({ rosterId: 5, matchupId: 3, points: 95, teamName: "E" }),
      entry({ rosterId: 6, matchupId: 3, points: 70, teamName: "F" }),
    ];
    // 100 outscores 90, 80, 70 → 3 (half the other five is not claimed as "only opponent")
    expect(countTeamsOutscored(field[0]!, field)).toBe(3);
    // 90 outscores 80, 70 → 2
    expect(countTeamsOutscored(field[1]!, field)).toBe(2);
    // 110 outscores everyone else → 5
    expect(countTeamsOutscored(field[2]!, field)).toBe(5);
  });
});

describe("Houdini Act award accuracy", () => {
  it("does not claim only-opponent outscore when the winner beat half the league", () => {
    // Lowest-scoring winner is A (100) — old logic would pick A and say
    // "only outscored opponent". A actually outscores B, D, F (3 of 5 others).
    const entries = [
      entry({ rosterId: 1, matchupId: 1, points: 100, teamName: "Escape Artists" }),
      entry({ rosterId: 2, matchupId: 1, points: 90, teamName: "Soft Landing" }),
      entry({ rosterId: 3, matchupId: 2, points: 130, teamName: "High Flyers" }),
      entry({ rosterId: 4, matchupId: 2, points: 80, teamName: "Floor Squad" }),
      entry({ rosterId: 5, matchupId: 3, points: 120, teamName: "Steady Eddies" }),
      entry({ rosterId: 6, matchupId: 3, points: 70, teamName: "Bottom Feeders" }),
    ];

    const { awards } = buildWeekReport({
      week: 7,
      entries,
      playersById: new Map(),
      playersByName: new Map(),
      rosterPositions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "K"],
      events: [],
      teams: entries.map((e) => ({
        slot: e.rosterId,
        team: e.teamName,
        owner: e.owner,
        logo: null,
        players: [],
      })),
    });

    const houdini = awards.find((a) => a.id === "lucky");
    expect(houdini).toBeTruthy();
    expect(houdini!.teamName).toBe("Escape Artists");
    const text = plainSentence(`${houdini!.leadName} ${houdini!.sentence}`);
    expect(text).not.toMatch(/only (team|club) they (would have beaten|outscored)/i);
    expect(text).toMatch(/outscoring (only |just )?3 of (the other )?5/i);
  });

  it("keeps only-opponent wording when the winner truly outscored nobody else", () => {
    const entries = [
      entry({ rosterId: 1, matchupId: 1, points: 85, teamName: "Houdini FC" }),
      entry({ rosterId: 2, matchupId: 1, points: 80, teamName: "Fall Guy" }),
      entry({ rosterId: 3, matchupId: 2, points: 140, teamName: "Juggernaut" }),
      entry({ rosterId: 4, matchupId: 2, points: 100, teamName: "Second Place" }),
      entry({ rosterId: 5, matchupId: 3, points: 120, teamName: "Contender" }),
      entry({ rosterId: 6, matchupId: 3, points: 95, teamName: "Also Ran" }),
    ];

    const { awards } = buildWeekReport({
      week: 7,
      entries,
      playersById: new Map(),
      playersByName: new Map(),
      rosterPositions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "K"],
      events: [],
      teams: entries.map((e) => ({
        slot: e.rosterId,
        team: e.teamName,
        owner: e.owner,
        logo: null,
        players: [],
      })),
    });

    const houdini = awards.find((a) => a.id === "lucky");
    expect(houdini).toBeTruthy();
    expect(houdini!.teamName).toBe("Houdini FC");
    expect(countTeamsOutscored(entries[0]!, entries)).toBe(1);
    const text = plainSentence(`${houdini!.leadName} ${houdini!.sentence}`);
    expect(text).toMatch(/only (team|club)/i);
  });
});
