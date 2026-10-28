import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSql, type FakeSql } from "@/test/fake-sql";

// A cookie jar standing in for next/headers.
const jar = new Map<string, { value: string; options?: Record<string, unknown> }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) =>
      jar.set(name, { value, options }),
    delete: (name: string) => jar.delete(name),
  }),
}));

type Household = {
  pin_hash: string | null;
  pin_failed: number;
  pin_locked_until: Date | null;
  pin_lockout_seconds: number;
};
let row: Household;
let sql: FakeSql;
vi.mock("@/lib/db", () => ({ db: () => sql }));

const { hashPin, sign } = await import("./crypto");
const { checkPin, lockPin, pinUnlocked, requirePinApi, setPin } = await import("./pin");

beforeAll(() => {
  process.env.FAMCAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});
beforeEach(() => {
  jar.clear();
  row = { pin_hash: hashPin("4821"), pin_failed: 0, pin_locked_until: null, pin_lockout_seconds: 300 };
  // Reads return the row; the attempt-counting update writes its values back into it.
  sql = fakeSql((q) => {
    if (q.text.startsWith("select")) return [row];
    if (q.text.includes("set pin_failed = $, pin_locked_until = $")) {
      const [failed, until, lockout] = q.values as [number, Date | null, number];
      row = { ...row, pin_failed: failed, pin_locked_until: until, pin_lockout_seconds: lockout };
    }
    if (q.text.includes("set pin_failed = 0")) row = { ...row, pin_failed: 0, pin_locked_until: null };
    return [];
  });
});
afterEach(() => vi.useRealTimers());

describe("unlock cookie", () => {
  it("unlocks for the user who entered the PIN, and only them", async () => {
    await checkPin("user-a", "4821");
    expect(await pinUnlocked("user-a")).toBe(true);
    expect(await pinUnlocked("user-b")).toBe(false);
    expect(jar.get("famcal_pin")?.options).toMatchObject({ httpOnly: true, sameSite: "lax", maxAge: 600 });
  });

  it("expires after 10 minutes", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-28T12:00:00Z") });
    await checkPin("user-a", "4821");
    vi.setSystemTime(new Date("2026-10-28T12:09:00Z"));
    expect(await pinUnlocked("user-a")).toBe(true);
    vi.setSystemTime(new Date("2026-10-28T12:10:01Z"));
    expect(await pinUnlocked("user-a")).toBe(false);
  });

  it("rejects a cookie that was edited or not signed by the server", async () => {
    jar.set("famcal_pin", { value: `user-a:${Date.now() + 600_000}` });
    expect(await pinUnlocked("user-a")).toBe(false);
    jar.set("famcal_pin", { value: sign(`user-a:${Date.now() + 600_000}`).replace("user-a", "user-b") });
    expect(await pinUnlocked("user-b")).toBe(false);
  });

  it("locks again on demand, and guards API routes until unlocked", async () => {
    expect((await requirePinApi("user-a"))?.status).toBe(403);
    await checkPin("user-a", "4821");
    expect(await requirePinApi("user-a")).toBeNull();
    await lockPin();
    expect(await pinUnlocked("user-a")).toBe(false);
  });
});

describe("checkPin (FR-6)", () => {
  it("counts down wrong attempts, then locks for 5 minutes", async () => {
    for (let left = 4; left >= 1; left--) {
      expect(await checkPin("user-a", "0000")).toEqual({ ok: false, reason: "wrong", attemptsLeft: left });
    }
    const fifth = await checkPin("user-a", "0000");
    expect(fifth).toMatchObject({ ok: false, reason: "locked" });
    const retryIn = Date.parse((fifth as { retryAt: string }).retryAt) - Date.now();
    expect(retryIn).toBeGreaterThan(299_000);
    expect(retryIn).toBeLessThanOrEqual(300_000);
  });

  it("refuses even the right PIN while locked", async () => {
    row.pin_locked_until = new Date(Date.now() + 60_000);
    expect(await checkPin("user-a", "4821")).toMatchObject({ ok: false, reason: "locked" });
    expect(await pinUnlocked("user-a")).toBe(false);
  });

  it("resets the count after the right PIN", async () => {
    await checkPin("user-a", "0000");
    expect(await checkPin("user-a", "4821")).toEqual({ ok: true });
    expect(row.pin_failed).toBe(0);
  });

  it("says when no PIN has been set", async () => {
    row.pin_hash = null;
    expect(await checkPin("user-a", "4821")).toEqual({ ok: false, reason: "unset" });
  });
});

describe("setPin", () => {
  it("needs no PIN the first time, and unlocks afterwards", async () => {
    row.pin_hash = null;
    expect(await setPin("user-a", "1234")).toBe(true);
    expect(sql.find("update famcal.household set pin_hash")).toHaveLength(1);
    expect(await pinUnlocked("user-a")).toBe(true);
  });

  it("needs the current unlock to change an existing PIN", async () => {
    expect(await setPin("user-a", "1234")).toBe(false);
    expect(sql.find("set pin_hash")).toHaveLength(0);
    await checkPin("user-a", "4821");
    expect(await setPin("user-a", "1234")).toBe(true);
  });
});
