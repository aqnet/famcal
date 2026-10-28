import { describe, expect, it } from "vitest";
import { DEFAULT_CALENDAR_COLORS, isAllowedCalendarColor } from "./colors";

describe("calendar colours", () => {
  it("allows the whole default palette", () => {
    expect(DEFAULT_CALENDAR_COLORS.every(isAllowedCalendarColor)).toBe(true);
  });

  it("refuses the accent and rain colours in either case, so events never look like UI", () => {
    for (const c of ["#1F5C5A", "#1f5c5a", "#6FB3AE", "#1F6FB2", "#7db4e6"]) {
      expect(isAllowedCalendarColor(c)).toBe(false);
    }
  });

  it("refuses anything that isn't #RRGGBB", () => {
    for (const c of ["red", "#fff", "#12345G", "1F5C5A0", "#1234567", "url(x)"]) {
      expect(isAllowedCalendarColor(c)).toBe(false);
    }
  });
});
