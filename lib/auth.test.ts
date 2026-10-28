import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSql, type FakeSql } from "@/test/fake-sql";

let user: { id: string; email?: string } | null;
let members: string[];
let sql: FakeSql;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
}));
vi.mock("@/lib/db", () => ({ db: () => sql }));
// redirect() throws in Next; make it observable.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

const { requireMemberApi, requireMemberPage, safeNext } = await import("./auth");

beforeEach(() => {
  user = null;
  members = ["member-1"];
  sql = fakeSql((q) => (members.includes(q.values[0] as string) ? [{ "?column?": 1 }] : []));
});

describe("requireMemberApi (FR-8, FR-9)", () => {
  it("answers 401 without a session", async () => {
    const res = await requireMemberApi();
    expect(res).toMatchObject({ status: 401 });
  });

  it("answers 403 to a user of another app on the shared Supabase project", async () => {
    user = { id: "other-app-user", email: "x@example.com" };
    const res = await requireMemberApi();
    expect(res).toMatchObject({ status: 403 });
    expect(sql.find("from famcal.members")[0].values).toEqual(["other-app-user"]);
  });

  it("returns the member when they're on the allowlist", async () => {
    user = { id: "member-1", email: "mom@example.com" };
    expect(await requireMemberApi()).toEqual({ userId: "member-1", email: "mom@example.com" });
  });

  it("loses access as soon as they're removed", async () => {
    user = { id: "member-1" };
    members = [];
    expect(await requireMemberApi()).toMatchObject({ status: 403 });
  });
});

describe("requireMemberPage", () => {
  it("sends signed-out visitors to login and non-members to the no-access page", async () => {
    await expect(requireMemberPage()).rejects.toThrow("redirect:/login");
    user = { id: "other-app-user" };
    await expect(requireMemberPage()).rejects.toThrow("redirect:/auth/no-access");
    user = { id: "member-1", email: "mom@example.com" };
    await expect(requireMemberPage()).resolves.toEqual({ userId: "member-1", email: "mom@example.com" });
  });
});

describe("safeNext", () => {
  it("keeps same-origin paths", () => {
    expect(safeNext("/settings?tab=photos")).toBe("/settings?tab=photos");
  });

  it("rejects anything that could leave the site", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "settings", "", null]) {
      expect(safeNext(bad)).toBe("/");
    }
  });
});
