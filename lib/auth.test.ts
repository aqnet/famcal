import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({}));
vi.mock("@/lib/db", () => ({}));

const { safeNext } = await import("./auth");

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
