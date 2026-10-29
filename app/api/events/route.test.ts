import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

let member: { userId: string; email: string } | NextResponse;
vi.mock("@/lib/auth", () => ({ requireMemberApi: async () => member }));
vi.mock("@/lib/pin", () => ({ pinUnlocked: vi.fn(async () => false) }));
vi.mock("@/lib/events", () => ({
  listEvents: vi.fn(async () => ({ events: [] })),
  createEvent: vi.fn(async () => ({ id: "new" })),
  updateEvent: vi.fn(async () => ({})),
  rescheduleEvent: vi.fn(async () => ({})),
  deleteEvent: vi.fn(async () => undefined),
  rsvp: vi.fn(async () => ({})),
  eventGuests: vi.fn(async () => []),
  knownGuestEmails: vi.fn(async () => new Set(["mom@example.com"])),
}));

const events = await import("@/lib/events");
const pin = await import("@/lib/pin");
const { GoogleApiError, GoogleAuthError } = await import("@/lib/google");
const { GET, POST } = await import("./route");

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/events?${qs}`));
const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/events", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

const ref = { accountId: "acc", calendarId: "cal", eventId: "ev" };
const event = {
  title: "Soccer",
  start: "2026-10-31T16:00:00Z",
  end: "2026-10-31T17:00:00Z",
  allDay: false,
  outdoor: false,
};
const create = (e: object) =>
  post({ action: "create", accountId: "acc", calendarId: "cal", event: { ...event, ...e } });

beforeEach(() => {
  vi.clearAllMocks();
  member = { userId: "user-a", email: "a@example.com" };
});

describe("access (FR-8)", () => {
  it("passes the auth refusal straight through, before reading anything", async () => {
    member = NextResponse.json({ error: "forbidden" }, { status: 403 });
    expect((await get("timeMin=2026-10-25T00:00:00Z&timeMax=2026-11-01T00:00:00Z")).status).toBe(403);
    expect((await create({})).status).toBe(403);
    expect(events.listEvents).not.toHaveBeenCalled();
    expect(events.createEvent).not.toHaveBeenCalled();
  });
});

describe("GET", () => {
  it("lists a valid range", async () => {
    const res = await get("timeMin=2026-10-25T00:00:00Z&timeMax=2026-11-01T00:00:00Z");
    expect(res.status).toBe(200);
    expect(events.listEvents).toHaveBeenCalledWith("2026-10-25T00:00:00.000Z", "2026-11-01T00:00:00.000Z");
  });

  it("refuses missing, backwards, unparseable or over-62-day ranges", async () => {
    for (const qs of [
      "",
      "timeMin=2026-10-25T00:00:00Z",
      "timeMin=2026-11-01T00:00:00Z&timeMax=2026-10-25T00:00:00Z",
      "timeMin=soon&timeMax=later",
      "timeMin=2026-01-01T00:00:00Z&timeMax=2026-03-05T00:00:00Z",
    ]) {
      expect((await get(qs)).status, qs).toBe(400);
    }
    expect(events.listEvents).not.toHaveBeenCalled();
  });
});

describe("POST validation", () => {
  it("creates a valid event", async () => {
    const res = await create({});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "new" });
  });

  it("refuses malformed bodies and events", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({ action: "nope" })).status).toBe(400);
    for (const bad of [
      { title: "   " },
      { end: "2026-10-31T16:00:00Z" }, // ends when it starts
      { allDay: true, start: "2026-10-31", end: "2026-10-31" },
      { allDay: true, start: "Oct 31", end: "Nov 1" },
      { guests: ["not-an-email"] },
      { reminder: -5 },
      { reminder: 40321 }, // over Google's four weeks
      { reminder: "10" },
    ]) {
      expect((await create(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(events.createEvent).not.toHaveBeenCalled();
  });

  it("refuses reschedules that go backwards or run over a week", async () => {
    const r = (start: string, end: string) => post({ action: "reschedule", ref, scope: "this", start, end });
    expect((await r("2026-10-31T17:00:00Z", "2026-10-31T16:00:00Z")).status).toBe(400);
    expect((await r("2026-10-31T16:00:00Z", "2026-11-08T16:00:00Z")).status).toBe(400);
    expect((await r("2026-10-31T16:00:00Z", "2026-10-31T18:00:00Z")).status).toBe(200);
  });

  it("only accepts real RSVP answers", async () => {
    expect((await post({ action: "rsvp", ref, status: "maybe" })).status).toBe(400);
    expect((await post({ action: "rsvp", ref, status: "declined" })).status).toBe(200);
  });
});

describe("guests and the PIN (FR-60)", () => {
  it("invites family and recent guests without the PIN, in any case", async () => {
    expect((await create({ guests: ["Mom@Example.com"] })).status).toBe(200);
  });

  it("asks for the PIN for an address it hasn't seen", async () => {
    const res = await create({ guests: ["stranger@example.com"] });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "pin_required" });
    expect(events.createEvent).not.toHaveBeenCalled();
  });

  it("allows it once Settings is unlocked", async () => {
    vi.mocked(pin.pinUnlocked).mockResolvedValueOnce(true);
    expect((await create({ guests: ["stranger@example.com"] })).status).toBe(200);
  });

  it("doesn't ask again for guests already on the event", async () => {
    vi.mocked(events.eventGuests).mockResolvedValueOnce(["already@example.com"]);
    const res = await post({
      action: "update",
      ref,
      scope: "this",
      event: { ...event, guests: ["already@example.com"] },
    });
    expect(res.status).toBe(200);
    expect(events.updateEvent).toHaveBeenCalledWith(
      ref,
      expect.objectContaining({ title: "Soccer" }),
      "this",
    );
  });
});

describe("Google failures", () => {
  it("asks to reconnect when the account's access is gone", async () => {
    vi.mocked(events.createEvent).mockRejectedValueOnce(new GoogleAuthError("invalid_grant"));
    const res = await create({});
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "reconnect" });
  });

  it("reports a Google API error as 502 with its status", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(events.deleteEvent).mockRejectedValueOnce(new GoogleApiError(403, "forbidden"));
    const res = await post({ action: "delete", ref, scope: "this" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "google", status: 403 });
  });

  it("notifies guests on delete unless told not to", async () => {
    await post({ action: "delete", ref, scope: "all" });
    await post({ action: "delete", ref, scope: "this", notify: false });
    expect(vi.mocked(events.deleteEvent).mock.calls).toEqual([
      [ref, "all", true],
      [ref, "this", false],
    ]);
  });
});
