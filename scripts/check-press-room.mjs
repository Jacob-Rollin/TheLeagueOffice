/**
 * Smoke checks for Press Room league keys + fact grounding helpers.
 * Run: node scripts/check-press-room.mjs
 */
import assert from "node:assert/strict";

function pressRoomLeagueKey(input) {
  const platform = String(input.platform ?? "").trim().toLowerCase();
  if (!platform || platform === "sandbox") return null;
  const rawId =
    platform === "native"
      ? String(input.nativeLeagueId || input.leagueId || "").trim()
      : String(input.leagueId || "").trim();
  if (!rawId) return null;
  const seasonNum = Number(input.season);
  const season =
    Number.isFinite(seasonNum) && seasonNum > 2000 ? Math.floor(seasonNum) : new Date().getUTCFullYear();
  return `${platform}:${rawId}:${season}`;
}

function parsePressRoomLeagueKey(leagueKey) {
  const parts = String(leagueKey ?? "").trim().split(":");
  if (parts.length < 3) return null;
  const season = Number(parts[parts.length - 1]);
  if (!Number.isFinite(season)) return null;
  const platform = parts[0].toLowerCase();
  const leagueId = parts.slice(1, -1).join(":");
  if (!platform || !leagueId) return null;
  return { platform, leagueId, season };
}

assert.equal(
  pressRoomLeagueKey({ platform: "sleeper", leagueId: "987654", season: 2025 }),
  "sleeper:987654:2025",
);
assert.equal(
  pressRoomLeagueKey({
    platform: "native",
    leagueId: "link",
    nativeLeagueId: "native-uuid",
    season: "2025",
  }),
  "native:native-uuid:2025",
);
assert.deepEqual(parsePressRoomLeagueKey("espn:551234:2025"), {
  platform: "espn",
  leagueId: "551234",
  season: 2025,
});

console.log("press-room smoke checks ok");
