import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

let member: { userId: string; email: string } | NextResponse;
vi.mock("@/lib/auth", () => ({ requireMemberApi: async () => member }));
vi.mock("@/lib/pin", () => ({
  checkPin: vi.fn(async () => ({ ok: true })),
  lockPin: vi.fn(async () => undefined),
  pinUnlocked: vi.fn(async () => false),
  setPin: vi.fn(async () => true),
}));
const pin = await import("@/lib/pin");
const { GET, POST } = await import("./route");

const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/pin", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  member = { userId: "user-a", email: "a@example.com" };
});

describe("/api/pin", () => {
  it("is for members only", async () => {
    member = NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    expect((await GET()).status).toBe(401);
    expect((await post({ action: "check", pin: "1234" })).status).toBe(401);
    expect(pin.checkPin).not.toHaveBeenCalled();
  });

  it("reports whether this device is unlocked", async () => {
    expect(await (await GET()).json()).toEqual({ unlocked: false });
  });

  it("only takes four digits", async () => {
    for (const bad of [undefined, "123", "12345", "abcd", "12 4"]) {
      const res = await post({ action: "check", pin: bad });
      expect(res.status, String(bad)).toBe(400);
    }
    expect(pin.checkPin).not.toHaveBeenCalled();
  });

  it("checks a PIN for the signed-in member", async () => {
    vi.mocked(pin.checkPin).mockResolvedValueOnce({ ok: false, reason: "wrong", attemptsLeft: 3 });
    expect(await (await post({ action: "check", pin: "0000" })).json()).toEqual({
      ok: false,
      reason: "wrong",
      attemptsLeft: 3,
    });
    expect(pin.checkPin).toHaveBeenCalledWith("user-a", "0000");
  });

  it("refuses to change the PIN without the current unlock", async () => {
    vi.mocked(pin.setPin).mockResolvedValueOnce(false);
    const res = await post({ action: "set", pin: "1234" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "pin_required" });
  });

  it("locks without needing a PIN", async () => {
    expect((await post({ action: "lock" })).status).toBe(200);
    expect(pin.lockPin).toHaveBeenCalled();
  });
});
