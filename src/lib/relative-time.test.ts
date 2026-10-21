import { describe, expect, it } from "vitest";

import { formatRelativeTimeAgo, parseServerDateMs } from "@/lib/relative-time";

describe("parseServerDateMs", () => {
  it("treats bare MySQL UTC datetimes as UTC", () => {
    const ms = parseServerDateMs("2026-10-21 17:00:00");
    expect(ms).toBe(Date.parse("2026-10-21T17:00:00Z"));
  });

  it("preserves explicit Z / offset timestamps", () => {
    expect(parseServerDateMs("2026-10-21T17:00:00Z")).toBe(Date.parse("2026-10-21T17:00:00Z"));
    expect(parseServerDateMs("2026-10-21T12:00:00-05:00")).toBe(
      Date.parse("2026-10-21T12:00:00-05:00"),
    );
  });
});

describe("formatRelativeTimeAgo", () => {
  const now = Date.parse("2026-10-21T18:00:00Z");

  it("shows just now under one minute", () => {
    expect(formatRelativeTimeAgo(now - 15_000, now)).toBe("just now");
  });

  it("does not force a 1m floor for brand-new items", () => {
    expect(formatRelativeTimeAgo(now - 500, now)).toBe("just now");
  });

  it("formats minutes and hours", () => {
    expect(formatRelativeTimeAgo(now - 3 * 60_000, now)).toBe("3m ago");
    expect(formatRelativeTimeAgo(now - 2 * 60 * 60_000, now)).toBe("2h ago");
  });

  it("clamps future clocks to just now", () => {
    expect(formatRelativeTimeAgo(now + 60_000, now)).toBe("just now");
  });
});
