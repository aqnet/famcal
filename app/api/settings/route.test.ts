import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { fakeSql, type FakeSql } from "@/test/fake-sql";

let member: { userId: string; email: string } | NextResponse;
let unlocked: boolean;
let sql: FakeSql;
vi.mock("@/lib/auth", () => ({ requireMemberApi: async () => member }));
vi.mock("@/lib/pin", () => ({
  requirePinApi: async () =>
    unlocked ? null : NextResponse.json({ error: "pin_required" }, { status: 403 }),
}));
vi.mock("@/lib/db", () => ({ db: () => sql }));
vi.mock("@/lib/household", () => ({ getHousehold: vi.fn(async () => ({ units: "F" })) }));
vi.mock("@/lib/google", () => ({
  listAccounts: vi.fn(async () => []),
  listCalendars: vi.fn(async () => []),
  revoke: vi.fn(async () => undefined),
  syncCalendars: vi.fn(async () => undefined),
}));
vi.mock("@/lib/weather", () => ({
  geocodeZip: vi.fn(async (zip: string) =>
    zip === "98103" ? { zip: "98103", place: "Seattle, WA", lat: 47.66, lon: -122.34 } : null,
  ),
}));
vi.mock("@/lib/smugmug", () => ({
  SmugMugError: class extends Error {},
  resolveSource: vi.fn(),
}));
const inviteUserByEmail = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { admin: { inviteUserByEmail } } }),
}));

const smugmug = await import("@/lib/smugmug");
const { GET, PATCH, POST } = await import("./route");

const send = (method: "PATCH" | "POST", body: unknown) =>
  (method === "PATCH" ? PATCH : POST)(
    new NextRequest("http://localhost:3000/api/settings", { method, body: JSON.stringify(body) }),
  );
const patch = (body: unknown) => send("PATCH", body);
const post = (body: unknown) => send("POST", body);
const updates = () => sql.find("update famcal.household set").filter((q) => !q.text.includes("updated_at"));

beforeEach(() => {
  vi.clearAllMocks();
  member = { userId: "user-a", email: "a@example.com" };
  unlocked = true;
  sql = fakeSql();
});

describe("everything is behind the PIN (FR-4)", () => {
  it("refuses reads and writes while locked, without touching the database", async () => {
    unlocked = false;
    for (const res of [
      await GET(),
      await patch({ units: "C" }),
      await post({ action: "removeMember", userId: "x" }),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "pin_required" });
    }
    expect(sql.queries).toHaveLength(0);
  });

  it("checks sign-in before the PIN", async () => {
    member = NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    expect((await patch({ units: "C" })).status).toBe(401);
  });
});

describe("PATCH", () => {
  it("stores the place that matches the ZIP", async () => {
    expect((await patch({ weatherZip: " 98103 " })).status).toBe(200);
    expect(updates()[0].values).toEqual(["98103", "Seattle, WA", 47.66, -122.34]);
  });

  it("refuses an unknown ZIP", async () => {
    const res = await patch({ weatherZip: "00000" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown ZIP code." });
    expect(updates()).toHaveLength(0);
  });

  it("validates units, rotation and night hours", async () => {
    for (const bad of [
      { units: "K" },
      { rotationSeconds: 4 },
      { rotationSeconds: 601 },
      { rotationSeconds: "soon" },
      { nightStart: "9pm" },
      { nightEnd: "24:00" },
    ]) {
      expect((await patch(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(updates()).toHaveLength(0);
    expect((await patch({ rotationSeconds: 19.6, nightStart: "21:00" })).status).toBe(200);
    expect(updates().map((q) => q.values)).toEqual([[20], ["21:00"]]);
  });

  it("cleans outdoor keywords: trimmed, lower-case, no blanks, at most 50", async () => {
    const many = Array.from({ length: 60 }, (_, i) => `w${i}`);
    await patch({ outdoorKeywords: ["  Soccer ", "", "HIKE", ...many] });
    const [words] = updates()[0].values as [string[]];
    expect(words.slice(0, 2)).toEqual(["soccer", "hike"]);
    expect(words).toHaveLength(50);
  });

  it("keeps only family members with a name and a valid email, lower-cased, at most 20", async () => {
    await patch({
      familyMembers: [
        { name: " Mom ", email: " Mom@Example.com " },
        { name: "", email: "noname@example.com" },
        { name: "Bad", email: "not an email" },
        ...Array.from({ length: 25 }, (_, i) => ({ name: `K${i}`, email: `k${i}@example.com` })),
      ],
    });
    const [fam] = updates()[0].values as [{ name: string; email: string }[]];
    expect(fam[0]).toEqual({ name: "Mom", email: "mom@example.com" });
    expect(fam).toHaveLength(20);
  });

  it("keeps only well-formed photo sources and clamps their options", async () => {
    await patch({
      photoSources: [
        {
          url: "https://x.smugmug.com/a",
          nodeId: "Abc123",
          name: "Family",
          type: "Folder",
          newest: 99999,
          keyword: " beach ",
        },
        { url: "https://x.smugmug.com/b", nodeId: "../../etc", name: "Evil", type: "Album" },
        { url: "https://x.smugmug.com/c", nodeId: "Xyz", name: "Odd", type: "Page", newest: 0 },
      ],
    });
    const [sources] = updates()[0].values as [Record<string, unknown>[]];
    expect(sources.map((s) => s.nodeId)).toEqual(["Abc123", "Xyz"]);
    expect(sources[0]).toMatchObject({ type: "Folder", newest: 5000, keyword: "beach" });
    expect(sources[1]).toMatchObject({ type: "Album", newest: undefined });
  });
});

describe("POST", () => {
  it("refuses reserved calendar colours", async () => {
    const res = await post({ action: "calendar", accountId: "a", calendarId: "c", color: "#1F5C5A" });
    expect(res.status).toBe(400);
    expect(sql.find("update famcal.calendars")).toHaveLength(0);
  });

  it("won't let you remove yourself", async () => {
    const res = await post({ action: "removeMember", userId: "user-a" });
    expect(res.status).toBe(400);
    expect(sql.find("delete from famcal.members")).toHaveLength(0);
    expect((await post({ action: "removeMember", userId: "user-b" })).status).toBe(200);
    expect(sql.find("delete from famcal.members")[0].values).toEqual(["user-b"]);
  });

  it("invites a new member with a link back to set their password", async () => {
    inviteUserByEmail.mockResolvedValueOnce({ data: { user: { id: "new-user" } }, error: null });
    const res = await post({ action: "invite", email: " Kid@Example.com " });
    expect(await res.json()).toEqual({ invited: true, email: "kid@example.com" });
    expect(inviteUserByEmail).toHaveBeenCalledWith("kid@example.com", {
      redirectTo: "http://localhost:3000/auth/confirm?next=/auth/reset",
    });
    expect(sql.find("insert into famcal.members")[0].values).toEqual([
      "new-user",
      "kid@example.com",
      "user-a",
    ]);
  });

  it("adds someone who already has an account on the shared project without emailing them", async () => {
    inviteUserByEmail.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "already registered" },
    });
    sql = fakeSql((q) => (q.text.includes("from auth.users") ? [{ id: "existing" }] : []));
    const res = await post({ action: "invite", email: "dad@example.com" });
    expect(await res.json()).toEqual({ invited: false, email: "dad@example.com" });
    expect(sql.find("insert into famcal.members")[0].values[0]).toBe("existing");
  });

  it("refuses an invite to a bad address", async () => {
    expect((await post({ action: "invite", email: "nope" })).status).toBe(400);
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("explains a SmugMug link it can't use", async () => {
    vi.mocked(smugmug.resolveSource).mockRejectedValueOnce(new smugmug.SmugMugError("That link is a page."));
    const res = await post({ action: "resolvePhotos", url: "https://x.smugmug.com/page" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That link is a page." });
  });

  it("refuses unknown actions", async () => {
    expect((await post({ action: "dropTables" })).status).toBe(400);
  });
});
