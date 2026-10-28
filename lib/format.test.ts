import { describe, expect, it } from "vitest";
import { age, fmtHour, fmtTimeShort, googleStatusText, hhmm, initials } from "./format";

describe("format", () => {
  it("labels grid hours, midnight to midnight", () => {
    expect([0, 6, 11, 12, 13, 23, 24].map(fmtHour)).toEqual([
      "12 AM",
      "6 AM",
      "11 AM",
      "12 PM",
      "1 PM",
      "11 PM",
      "12 AM",
    ]);
  });

  it("drops :00 from short times", () => {
    expect(fmtTimeShort(new Date(2026, 9, 28, 9, 0))).toBe("9 AM");
    expect(fmtTimeShort(new Date(2026, 9, 28, 9, 30))).toBe("9:30 AM");
  });

  it("pads HH:MM", () => {
    expect(hhmm(new Date(2026, 9, 28, 7, 5))).toBe("07:05");
  });

  it("says how old a reading is", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    expect(age("2026-10-28T11:20:00Z", now)).toBe("40 min ago");
    expect(age("2026-10-28T09:00:00Z", now)).toBe("3 h ago");
    expect(age("2026-10-25T12:00:00Z", now)).toBe("3 d ago");
  });

  it("makes two-letter initials from names and email addresses", () => {
    expect(initials("Anderson Quach")).toBe("AQ");
    expect(initials("quachfamily1517@gmail.com")).toBe("QU");
    expect(initials("first.last@example.com")).toBe("FL");
  });

  it("explains each Google connect result", () => {
    expect(googleStatusText(undefined)).toBeNull();
    expect(googleStatusText("connected")).toEqual({ text: "Google account connected.", error: false });
    for (const s of ["denied", "api-disabled", "auth", "state", "anything-else"]) {
      expect(googleStatusText(s)?.error).toBe(true);
    }
  });
});
