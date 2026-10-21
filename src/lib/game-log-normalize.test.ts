import { describe, expect, it } from "vitest";

import { normalizeFumbleRaw } from "@/lib/game-log-normalize";

describe("normalizeFumbleRaw", () => {
  it("keeps Sleeper fum when present (Carnell Tate week 4: 2 fum / 1 lost)", () => {
    expect(normalizeFumbleRaw({ fum: 2, fum_lost: 1 })).toEqual({ fum: 2, fum_lost: 1 });
  });

  it("fills fum from fum_lost when fum is missing", () => {
    expect(normalizeFumbleRaw({ fum_lost: 1 })).toEqual({ fum: 1, fum_lost: 1 });
  });

  it("raises fum up to fum_lost when inconsistent", () => {
    expect(normalizeFumbleRaw({ fum: 0, fum_lost: 1 })).toEqual({ fum: 1, fum_lost: 1 });
  });

  it("leaves rows without lost fumbles unchanged", () => {
    expect(normalizeFumbleRaw({ rec: 5, fum: 0 })).toEqual({ rec: 5, fum: 0 });
    expect(normalizeFumbleRaw({ rec: 5 })).toEqual({ rec: 5 });
  });
});
