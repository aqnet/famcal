import { describe, expect, it } from "vitest";
import {
  dedupeEvents,
  guessOutdoor,
  layoutAllDay,
  layoutDay,
  monthGrid,
  normalizeEvent,
  type CalEvent,
  type GoogleEvent,
} from "./calendar-model";

const ctx = { accountId: "fam", calendarId: "primary", accessRole: "owner", isFamily: true };

function local(y: number, m: number, d: number, h = 0, min = 0) {
  return new Date(y, m - 1, d, h, min).toISOString();
}

function timed(id: string, start: string, end: string, extra: Partial<GoogleEvent> = {}): CalEvent {
  return normalizeEvent(
    { id, iCalUID: `${id}@google.com`, start: { dateTime: start }, end: { dateTime: end }, ...extra },
    ctx,
  )!;
}

describe("normalizeEvent", () => {
  it("hides details of private events on non-family accounts", () => {
    const e = normalizeEvent(
      {
        id: "a",
        summary: "Doctor",
        location: "Clinic",
        visibility: "private",
        start: { dateTime: local(2026, 10, 27, 9) },
        end: { dateTime: local(2026, 10, 27, 10) },
      },
      { ...ctx, accountId: "mom", isFamily: false },
    )!;
    expect(e.title).toBe("Busy");
    expect(e.location).toBeUndefined();
    expect(e.canEdit).toBe(false);
  });

  it("reads the outdoor flag and edit rights", () => {
    const e = normalizeEvent(
      {
        id: "a",
        summary: "Lunch",
        start: { dateTime: local(2026, 10, 27, 12) },
        end: { dateTime: local(2026, 10, 27, 13) },
        organizer: { email: "x@example.com" },
        attendees: [{ email: "fam@example.com", self: true, responseStatus: "needsAction" }],
        extendedProperties: { private: { famcalOutdoor: "0" } },
      },
      ctx,
    )!;
    expect(e.outdoor).toBe(false);
    expect(e.canEdit).toBe(false);
    expect(e.canRsvp).toBe(true);
  });

  it("drops cancelled occurrences", () => {
    expect(normalizeEvent({ id: "a", status: "cancelled" }, ctx)).toBeNull();
  });
});

describe("dedupeEvents", () => {
  it("merges the same occurrence from two accounts and prefers the organiser's copy", () => {
    const base = {
      iCalUID: "m@x",
      start: { dateTime: local(2026, 10, 27, 9) },
      end: { dateTime: local(2026, 10, 27, 10) },
    };
    const guestCopy = normalizeEvent(
      { ...base, id: "g", organizer: { email: "dad@x" } },
      { ...ctx, accountId: "fam" },
    )!;
    const orgCopy = normalizeEvent(
      { ...base, id: "o", organizer: { email: "dad@x", self: true } },
      { ...ctx, accountId: "dad", isFamily: false },
    )!;
    const merged = dedupeEvents([guestCopy, orgCopy], "fam");
    expect(merged).toHaveLength(1);
    expect(merged[0].accountId).toBe("dad");
    expect(merged[0].accountIds.sort()).toEqual(["dad", "fam"]);
  });

  it("keeps different occurrences of one repeating event apart", () => {
    const occ = (day: number) =>
      normalizeEvent(
        {
          id: `r_${day}`,
          iCalUID: "r@x",
          recurringEventId: "r",
          originalStartTime: { dateTime: local(2026, 10, day, 9) },
          start: { dateTime: local(2026, 10, day, 9) },
          end: { dateTime: local(2026, 10, day, 10) },
        },
        ctx,
      )!;
    expect(dedupeEvents([occ(26), occ(27)])).toHaveLength(2);
  });
});

describe("guessOutdoor", () => {
  it("matches keywords at word starts", () => {
    expect(guessOutdoor("Soccer practice", ["soccer"])).toBe(true);
    expect(guessOutdoor("Hiking with Sam", ["hike"])).toBe(false);
    expect(guessOutdoor("Hike Mt Tam", ["hike"])).toBe(true);
    expect(guessOutdoor("Parkour", ["park"])).toBe(true);
  });
});

describe("layoutDay", () => {
  const day = new Date(2026, 9, 27);

  it("puts overlapping events side by side", () => {
    const { placements } = layoutDay(
      [
        timed("a", local(2026, 10, 27, 9), local(2026, 10, 27, 10)),
        timed("b", local(2026, 10, 27, 9, 30), local(2026, 10, 27, 11)),
      ],
      day,
    );
    expect(placements.map((p) => [p.event.id, p.col, p.cols])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
    ]);
  });

  it("collapses a fourth overlapping event into +N", () => {
    const evts = ["a", "b", "c", "d"].map((id) => timed(id, local(2026, 10, 27, 9), local(2026, 10, 27, 10)));
    const { placements, overflow } = layoutDay(evts, day);
    expect(placements).toHaveLength(3);
    expect(overflow).toEqual([{ startMin: 540, endMin: 600, count: 1 }]);
  });

  it("splits an event crossing midnight", () => {
    const e = timed("late", local(2026, 10, 27, 22), local(2026, 10, 28, 1));
    expect(layoutDay([e], day).placements[0]).toMatchObject({ startMin: 1320, endMin: 1440 });
    expect(layoutDay([e], new Date(2026, 9, 28)).placements[0]).toMatchObject({ startMin: 0, endMin: 60 });
  });
});

describe("layoutAllDay", () => {
  it("packs bars into two rows and counts the rest", () => {
    const allDay = (id: string, s: string, e: string) =>
      normalizeEvent({ id, start: { date: s }, end: { date: e } }, ctx)!;
    const { bars, hiddenPerDay } = layoutAllDay(
      [
        allDay("trip", "2026-10-25", "2026-10-28"),
        allDay("x", "2026-10-26", "2026-10-27"),
        allDay("y", "2026-10-26", "2026-10-27"),
      ],
      new Date(2026, 9, 25),
      7,
    );
    expect(bars.map((b) => [b.event.id, b.fromCol, b.toCol, b.row])).toEqual([
      ["trip", 0, 2, 0],
      ["x", 1, 1, 1],
    ]);
    expect(hiddenPerDay).toEqual([0, 1, 0, 0, 0, 0, 0]);
  });
});

describe("monthGrid", () => {
  it("covers October 2026 in 5 Sunday-first rows", () => {
    const grid = monthGrid(new Date(2026, 9, 1));
    expect(grid).toHaveLength(35);
    expect(grid[0].getDate()).toBe(27); // Sun 27 Sep
    expect(grid[4].getDate()).toBe(1); // Thu 1 Oct
  });
});
