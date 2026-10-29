import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSql, type FakeSql } from "@/test/fake-sql";
import type { GoogleEvent } from "./calendar-model";

let sql: FakeSql;
vi.mock("@/lib/db", () => ({ db: () => sql }));
vi.mock("@/lib/household", () => ({
  getHousehold: vi.fn(async () => ({ familyMembers: [{ name: "Mom", email: "Mom@Example.com" }] })),
  getCache: vi.fn(async () => null),
  setCache: vi.fn(async () => undefined),
}));
vi.mock("@/lib/google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./google")>()),
  gcal: vi.fn(),
  listAccounts: vi.fn(),
  listCalendars: vi.fn(),
}));

const google = await import("./google");
const household = await import("./household");
const { createEvent, deleteEvent, knownGuestEmails, listEvents, rescheduleEvent, rsvp, updateEvent } =
  await import("./events");
const gcal = vi.mocked(google.gcal);

type Call = {
  path: string;
  method: string;
  query?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
};
const calls = (): Call[] =>
  gcal.mock.calls.map(([, path, init]) => ({
    path,
    method: init?.method ?? "GET",
    query: init?.query,
    body: init?.body as Record<string, unknown> | undefined,
  }));
const writes = () => calls().filter((c) => c.method !== "GET");

// Google answers GETs from a table of events by id; writes echo an id.
function googleHas(events: Record<string, GoogleEvent>) {
  gcal.mockImplementation(async (_acc, path, init) => {
    if ((init?.method ?? "GET") !== "GET") return { id: "new-id" } as never;
    const id = decodeURIComponent(path.split("/").pop()!);
    if (!events[id]) throw new google.GoogleApiError(404, "not found");
    return events[id] as never;
  });
}

const ref = { accountId: "acc-1", calendarId: "family@group", eventId: "occ-1" };
const input = {
  title: " Soccer ",
  start: "2026-10-31T16:00:00.000Z",
  end: "2026-10-31T17:00:00.000Z",
  allDay: false,
  outdoor: true,
};

beforeEach(() => {
  gcal.mockReset();
  sql = fakeSql((q) => (q.text.includes("access_role") ? [{ access_role: "writer" }] : []));
});

describe("writes", () => {
  it("won't write to a calendar the account can only read", async () => {
    sql = fakeSql(() => [{ access_role: "reader" }]);
    await expect(createEvent("acc-1", "holidays", input)).rejects.toThrow("not writable");
    expect(gcal).not.toHaveBeenCalled();
  });

  it("creates with a trimmed title, the outdoor flag, and no emails when there are no guests", async () => {
    googleHas({});
    await createEvent("acc-1", "family@group", input);
    const [c] = writes();
    expect(c).toMatchObject({
      method: "POST",
      path: "/calendars/family%40group/events",
      query: { sendUpdates: "none" },
    });
    expect(c.body).toMatchObject({
      summary: "Soccer",
      start: { dateTime: input.start, date: null },
      extendedProperties: { private: { famcalOutdoor: "1" } },
    });
  });

  it("sets a pop-up reminder, turns reminders off with null, and leaves them alone when absent", async () => {
    googleHas({ "occ-1": { id: "occ-1" } });
    await createEvent("acc-1", "family@group", { ...input, reminder: 10 });
    await updateEvent(ref, { ...input, reminder: null }, "this");
    await updateEvent(ref, input, "this");
    expect(writes().map((w) => w.body?.reminders)).toEqual([
      { useDefault: false, overrides: [{ method: "popup", minutes: 10 }] },
      { useDefault: false, overrides: [] },
      undefined,
    ]);
  });

  it("emails invitations when guests are added", async () => {
    googleHas({});
    await createEvent("acc-1", "family@group", { ...input, guests: ["Grandma@Example.com"] });
    expect(writes()[0].query).toEqual({ sendUpdates: "all" });
    expect(writes()[0].body?.attendees).toEqual([{ email: "grandma@example.com" }]);
  });

  it("merges guests: keeps self and organiser, drops removed guests, adds new ones", async () => {
    googleHas({
      "occ-1": {
        id: "occ-1",
        attendees: [
          { email: "family@example.com", self: true },
          { email: "boss@example.com", organizer: true },
          { email: "stays@example.com", responseStatus: "accepted" },
          { email: "goes@example.com" },
        ],
      },
    });
    await updateEvent(ref, { ...input, guests: ["stays@example.com", "new@example.com"] }, "this");
    expect(writes()[0].body?.attendees).toEqual([
      { email: "family@example.com", self: true },
      { email: "boss@example.com", organizer: true },
      { email: "stays@example.com", responseStatus: "accepted" },
      { email: "new@example.com" },
    ]);
  });

  it("edits one occurrence of a series on its own", async () => {
    googleHas({ "occ-1": { id: "occ-1", recurringEventId: "series" } });
    await updateEvent({ ...ref, recurringEventId: "series" }, input, "this");
    expect(writes()).toHaveLength(1);
    expect(writes()[0].path).toBe("/calendars/family%40group/events/occ-1");
  });

  it("moving one occurrence of a series by an hour moves the whole series by an hour", async () => {
    googleHas({
      "occ-1": {
        id: "occ-1",
        start: { dateTime: "2026-10-31T15:00:00.000Z" },
        end: { dateTime: "2026-10-31T16:00:00.000Z" },
      },
      series: {
        id: "series",
        start: { dateTime: "2026-09-05T15:00:00.000Z", timeZone: "America/Los_Angeles" } as never,
        end: { dateTime: "2026-09-05T16:00:00.000Z", timeZone: "America/Los_Angeles" } as never,
      },
    });
    await updateEvent({ ...ref, recurringEventId: "series" }, input, "all");
    const [c] = writes();
    expect(c.path).toBe("/calendars/family%40group/events/series");
    expect(c.body?.start).toEqual({ dateTime: "2026-09-05T16:00:00.000Z", timeZone: "America/Los_Angeles" });
    expect(c.body?.end).toEqual({ dateTime: "2026-09-05T17:00:00.000Z", timeZone: "America/Los_Angeles" });
  });

  it("shifts an all-day series by whole days", async () => {
    googleHas({
      "occ-1": { id: "occ-1", start: { date: "2026-10-31" }, end: { date: "2026-11-01" } },
      series: { id: "series", start: { date: "2026-09-05" }, end: { date: "2026-09-06" } },
    });
    const allDay = { ...input, allDay: true, start: "2026-11-02", end: "2026-11-03" };
    await updateEvent({ ...ref, recurringEventId: "series" }, allDay, "all");
    expect(writes()[0].body).toMatchObject({ start: { date: "2026-09-07" }, end: { date: "2026-09-08" } });
  });

  it("drag-to-resize sends only the times, keeping the event's time zone", async () => {
    googleHas({
      "occ-1": {
        id: "occ-1",
        summary: "Do not overwrite",
        start: { dateTime: "2026-10-31T15:00:00.000Z", timeZone: "America/Los_Angeles" } as never,
        end: { dateTime: "2026-10-31T16:00:00.000Z" },
      },
    });
    await rescheduleEvent(ref, "2026-10-31T15:30:00.000Z", "2026-10-31T17:00:00.000Z", "this");
    expect(writes()[0].body).toEqual({
      start: { dateTime: "2026-10-31T15:30:00.000Z", date: null, timeZone: "America/Los_Angeles" },
      end: { dateTime: "2026-10-31T17:00:00.000Z", date: null, timeZone: undefined },
    });
  });

  it("deletes the series for “all events”, and treats already-gone as done", async () => {
    gcal.mockRejectedValueOnce(new google.GoogleApiError(410, "gone"));
    await expect(deleteEvent({ ...ref, recurringEventId: "series" }, "all", false)).resolves.toBeUndefined();
    expect(calls()[0]).toMatchObject({
      path: "/calendars/family%40group/events/series",
      query: { sendUpdates: "none" },
    });
  });

  it("still reports other delete failures", async () => {
    gcal.mockRejectedValueOnce(new google.GoogleApiError(500, "boom"));
    await expect(deleteEvent(ref, "this", true)).rejects.toThrow("boom");
  });

  it("RSVP changes only the connected account's own reply", async () => {
    googleHas({
      "occ-1": {
        id: "occ-1",
        attendees: [
          { email: "family@example.com", self: true, responseStatus: "needsAction" },
          { email: "host@example.com", organizer: true, responseStatus: "accepted" },
        ],
      },
    });
    await rsvp(ref, "declined");
    expect(writes()[0].body?.attendees).toEqual([
      { email: "family@example.com", self: true, responseStatus: "declined" },
      { email: "host@example.com", organizer: true, responseStatus: "accepted" },
    ]);
  });
});

describe("listEvents", () => {
  const accounts = [
    { id: "fam", email: "family@example.com", isFamily: true, status: "ok" },
    { id: "dad", email: "dad@example.com", isFamily: false, status: "ok" },
  ];
  const calendars = [
    { accountId: "fam", calendarId: "fam-primary", accessRole: "owner", selected: true },
    { accountId: "dad", calendarId: "dad-primary", accessRole: "owner", selected: true },
    { accountId: "fam", calendarId: "hidden", accessRole: "owner", selected: false },
  ];
  const ev = (id: string, uid: string): GoogleEvent => ({
    id,
    iCalUID: uid,
    summary: id,
    start: { dateTime: "2026-10-31T16:00:00Z" },
    end: { dateTime: "2026-10-31T17:00:00Z" },
    attendees: [{ email: "Guest@Example.com" }],
  });

  beforeEach(() => {
    vi.mocked(google.listAccounts).mockResolvedValue(accounts as never);
    vi.mocked(google.listCalendars).mockResolvedValue(calendars as never);
  });

  it("reads every page of every shown calendar and merges a meeting both accounts have", async () => {
    gcal.mockImplementation(async (acc, _path, init) => {
      if (acc === "fam" && !init?.query?.pageToken)
        return { items: [ev("a", "uid-a")], nextPageToken: "p2" } as never;
      if (acc === "fam") return { items: [ev("shared", "uid-shared")] } as never;
      return { items: [ev("shared-dad", "uid-shared")] } as never;
    });
    const res = await listEvents("2026-10-25T00:00:00Z", "2026-11-01T00:00:00Z");
    expect(gcal.mock.calls.map(([acc, path]) => `${acc} ${path}`)).not.toContain(
      "fam /calendars/hidden/events",
    );
    expect(res.events.map((e) => e.title).sort()).toEqual(["a", "shared"]);
    expect(res.events.find((e) => e.title === "shared")?.accountIds.sort()).toEqual(["dad", "fam"]);
    expect(res.failedAccounts).toEqual([]);
    expect(household.setCache).toHaveBeenCalledWith(
      "recent_guests",
      ["guest@example.com"],
      expect.any(Number),
    );
  });

  it("reads each event's pop-up reminder, falling back to the calendar's defaults", async () => {
    gcal.mockImplementation(async (acc) =>
      acc === "fam"
        ? ({
            defaultReminders: [{ method: "popup", minutes: 30 }],
            items: [
              ev("default", "u1"),
              {
                ...ev("own", "u2"),
                reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 5 }] },
              },
              {
                ...ev("email-only", "u3"),
                reminders: { useDefault: false, overrides: [{ method: "email", minutes: 60 }] },
              },
            ],
          } as never)
        : ({ items: [] } as never),
    );
    const res = await listEvents("2026-10-25T00:00:00Z", "2026-11-01T00:00:00Z");
    const by = Object.fromEntries(res.events.map((e) => [e.title, e.reminder]));
    expect(by).toEqual({ default: 30, own: 5, "email-only": null });
  });

  it("keeps showing the other accounts when one fails", async () => {
    gcal.mockImplementation(async (acc) => {
      if (acc === "dad") throw new google.GoogleAuthError("invalid_grant");
      return { items: [ev("a", "uid-a")] } as never;
    });
    const res = await listEvents("2026-10-25T00:00:00Z", "2026-11-01T00:00:00Z");
    expect(res.events.map((e) => e.title)).toEqual(["a"]);
    expect(res.failedAccounts).toEqual(["dad"]);
  });
});

describe("knownGuestEmails", () => {
  it("is family members plus recent guests, lower-cased", async () => {
    vi.mocked(household.getCache).mockResolvedValueOnce({ value: ["recent@example.com"], fresh: true });
    expect([...(await knownGuestEmails())].sort()).toEqual(["mom@example.com", "recent@example.com"]);
  });
});
