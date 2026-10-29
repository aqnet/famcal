import { describe, expect, it } from "vitest";
import type { CalEvent } from "@/lib/calendar-model";
import {
  applyDraft,
  draftFromEvent,
  draftTimes,
  draftToInput,
  newDraft,
  nextHalfHour,
  remindLabel,
} from "./draft";

const cal = { accountId: "acc-1", calendarId: "family@group" };

function event(over: Partial<CalEvent> = {}): CalEvent {
  return {
    key: "k",
    id: "ev-1",
    accountId: "acc-1",
    calendarId: "family@group",
    accountIds: ["acc-1"],
    title: "Soccer",
    start: new Date(2026, 9, 31, 9, 0).toISOString(),
    end: new Date(2026, 9, 31, 10, 0).toISOString(),
    allDay: false,
    outdoor: null,
    busy: false,
    canEdit: true,
    canRsvp: false,
    organizerSelf: true,
    attendees: [],
    guestsCanInviteOthers: true,
    guestsCanSeeOtherGuests: true,
    guestsCanModify: false,
    reminder: null,
    ...over,
  };
}

describe("nextHalfHour", () => {
  it("rounds up to the next half hour", () => {
    expect(nextHalfHour(new Date(2026, 9, 28, 9, 10, 42))).toEqual(new Date(2026, 9, 28, 9, 30));
    expect(nextHalfHour(new Date(2026, 9, 28, 9, 30))).toEqual(new Date(2026, 9, 28, 10, 0));
    expect(nextHalfHour(new Date(2026, 9, 28, 23, 45))).toEqual(new Date(2026, 9, 29, 0, 0));
  });
});

describe("newDraft", () => {
  it("defaults to one hour on the chosen calendar", () => {
    const d = newDraft(new Date(2026, 9, 31, 9, 0), cal);
    expect(d).toMatchObject({ day: "2026-10-31", start: "09:00", end: "10:00", endDayOffset: 0, ...cal });
    expect(d.allDay).toBe(false);
    expect(d.sendUpdates).toBe(true);
  });

  it("takes a dragged range, including one that ends the next day", () => {
    const d = newDraft(new Date(2026, 9, 31, 23, 0), cal, new Date(2026, 10, 1, 1, 0));
    expect(d).toMatchObject({ start: "23:00", end: "01:00", endDayOffset: 1 });
  });
});

describe("draftFromEvent", () => {
  it("reads a timed event's day and times", () => {
    const d = draftFromEvent(event(), []);
    expect(d).toMatchObject({
      title: "Soccer",
      day: "2026-10-31",
      start: "09:00",
      end: "10:00",
      endDayOffset: 0,
    });
  });

  it("counts the days of a multi-day all-day event", () => {
    const d = draftFromEvent(event({ allDay: true, start: "2026-10-30", end: "2026-11-02" }), []);
    expect(d).toMatchObject({ allDay: true, day: "2026-10-30", allDayDays: 3 });
  });

  it("keeps an overnight event's end on the next day", () => {
    const d = draftFromEvent(
      event({
        start: new Date(2026, 9, 31, 22, 0).toISOString(),
        end: new Date(2026, 10, 1, 2, 0).toISOString(),
      }),
      [],
    );
    expect(d).toMatchObject({ start: "22:00", end: "02:00", endDayOffset: 1 });
  });

  it("guesses outdoor from keywords only when the flag was never set", () => {
    expect(draftFromEvent(event({ outdoor: null }), ["soccer"])).toMatchObject({
      outdoor: true,
      outdoorTouched: false,
    });
    expect(draftFromEvent(event({ outdoor: false }), ["soccer"])).toMatchObject({
      outdoor: false,
      outdoorTouched: true,
    });
  });

  it("lists guests without the calendar's own account", () => {
    const d = draftFromEvent(
      event({
        attendees: [
          { email: "family@example.com", status: "accepted", self: true },
          { email: "grandma@example.com", status: "needsAction" },
        ],
      }),
      [],
    );
    expect(d.guests).toEqual(["grandma@example.com"]);
  });
});

describe("draftTimes", () => {
  it("rolls an end before the start into the next day (11 PM → 1 AM)", () => {
    const d = { ...newDraft(new Date(2026, 9, 31, 23, 0), cal), end: "01:00", endDayOffset: 0 };
    const { start, end } = draftTimes(d);
    expect(start).toEqual(new Date(2026, 9, 31, 23, 0));
    expect(end).toEqual(new Date(2026, 10, 1, 1, 0));
  });

  it("makes all-day ranges end exclusive", () => {
    const d = { ...newDraft(new Date(2026, 9, 31, 9, 0), cal), allDay: true, allDayDays: 2 };
    expect(draftTimes(d)).toEqual({ start: new Date(2026, 9, 31), end: new Date(2026, 10, 2) });
  });
});

describe("draftToInput", () => {
  it("sends trimmed text and ISO times for a timed event", () => {
    const d = { ...newDraft(new Date(2026, 9, 31, 9, 0), cal), title: "  Soccer  ", location: " Park " };
    const input = draftToInput(d, false);
    expect(input).toMatchObject({ title: "Soccer", location: "Park", allDay: false });
    expect(input.start).toBe(new Date(2026, 9, 31, 9, 0).toISOString());
    expect(input.end).toBe(new Date(2026, 9, 31, 10, 0).toISOString());
  });

  it("sends dates for an all-day event", () => {
    const d = { ...newDraft(new Date(2026, 9, 31, 9, 0), cal), allDay: true, allDayDays: 1 };
    expect(draftToInput(d, false)).toMatchObject({ start: "2026-10-31", end: "2026-11-01" });
  });

  it("only emails guests when the guest list changed", () => {
    const d = { ...newDraft(new Date(2026, 9, 31, 9, 0), cal), guests: ["a@example.com"] };
    expect(draftToInput(d, false).sendUpdates).toBe(false);
    expect(draftToInput(d, true).sendUpdates).toBe(true);
    expect(draftToInput({ ...d, sendUpdates: false }, true).sendUpdates).toBe(false);
  });

  it("round-trips an event through the edit panel unchanged", () => {
    const e = event({ location: "Park", description: "Bring water" });
    const input = draftToInput(draftFromEvent(e, []), false);
    expect(input).toMatchObject({ title: e.title, start: e.start, end: e.end, location: "Park" });
  });
});

describe("applyDraft", () => {
  it("updates the event optimistically and keeps known guests' replies", () => {
    const base = event({ attendees: [{ email: "grandma@example.com", status: "accepted" }] });
    const d = {
      ...draftFromEvent(base, []),
      title: "Soccer final",
      guests: ["grandma@example.com", "new@example.com"],
    };
    const next = applyDraft(base, d);
    expect(next.title).toBe("Soccer final");
    expect(next.key).toBe(base.key);
    expect(next.attendees).toEqual([
      { email: "grandma@example.com", status: "accepted" },
      { email: "new@example.com", status: "needsAction" },
    ]);
  });
});

describe("reminders", () => {
  it("notifies 10 minutes before a new event by default", () => {
    const d = newDraft(new Date(2026, 9, 31, 9, 0), cal);
    expect(d).toMatchObject({ remind: true, remindMinutes: 10 });
    expect(draftToInput(d, false).reminder).toBe(10);
  });

  it("sends null to turn a new event's reminder off", () => {
    const d = { ...newDraft(new Date(2026, 9, 31, 9, 0), cal), remind: false };
    expect(draftToInput(d, false).reminder).toBeNull();
  });

  it("reads an event's reminder, and leaves it alone on save unless it was changed", () => {
    const d = draftFromEvent(event({ reminder: 15 }), []);
    expect(d).toMatchObject({ remind: true, remindMinutes: 15, remindTouched: false });
    expect("reminder" in draftToInput(d, false)).toBe(false);
    expect(draftToInput({ ...d, remind: false, remindTouched: true }, false).reminder).toBeNull();
  });

  it("offers the default lead time when an event has no reminder yet", () => {
    expect(draftFromEvent(event(), [])).toMatchObject({ remind: false, remindMinutes: 10 });
    expect(draftFromEvent(event({ allDay: true, start: "2026-10-31", end: "2026-11-01" }), [])).toMatchObject(
      {
        remind: false,
        remindMinutes: 420,
      },
    );
  });

  it("shows the reminder on the optimistic copy", () => {
    expect(applyDraft(event(), newDraft(new Date(2026, 9, 31, 9, 0), cal)).reminder).toBe(10);
  });

  it("labels lead times, counting all-day ones back from midnight", () => {
    expect(remindLabel(10, false)).toBe("10 min");
    expect(remindLabel(60, false)).toBe("1 h");
    expect(remindLabel(90, false)).toBe("1 h 30 min");
    expect(remindLabel(1440, false)).toBe("1 day");
    expect(remindLabel(420, true)).toBe("Day before, 5 PM");
    expect(remindLabel(900, true)).toBe("Day before, 9 AM");
    expect(remindLabel(2040, true)).toBe("2 days before, 2 PM");
  });
});
