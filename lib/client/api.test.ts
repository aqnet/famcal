import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, store } from "./api";

// The browser bits api() and store touch.
const location = { pathname: "/settings", href: "http://localhost/settings" };
const storage = new Map<string, string>();
const fetchMock = vi.fn();

beforeEach(() => {
  storage.clear();
  location.href = "http://localhost/settings";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", {
    location,
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("GETs by default and POSTs JSON when there's a body", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: 1 })));
    expect(await api("/api/config")).toEqual({ ok: 1 });
    await api("/api/events", { body: { action: "create" } });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      body: '{"action":"create"}',
      headers: { "content-type": "application/json" },
    });
  });

  it("sends a signed-out user to the login screen, back to where they were", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    await expect(api("/api/settings")).rejects.toMatchObject({ status: 401, code: "unauthenticated" });
    expect(location.href).toBe("/login?next=%2Fsettings");
  });

  it("turns an error response into an ApiError carrying the server's code and body", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "pin_required" }), { status: 403 }));
    const err = await api("/api/settings").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: "pin_required", body: { error: "pin_required" } });
  });

  it("copes with an error that isn't JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(api("/api/events")).rejects.toMatchObject({ status: 502, code: "failed" });
  });
});

describe("store", () => {
  it("round-trips JSON and falls back when empty or unreadable", () => {
    store.set("k", { a: 1 });
    expect(store.get("k", null)).toEqual({ a: 1 });
    expect(store.get("missing", "fallback")).toBe("fallback");
    storage.set("broken", "{not json");
    expect(store.get("broken", 7)).toBe(7);
    store.remove("k");
    expect(store.get("k", null)).toBeNull();
  });

  it("never throws when storage is blocked (private mode)", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("QuotaExceeded");
        },
        removeItem: () => {
          throw new Error("SecurityError");
        },
      },
    });
    expect(store.get("k", "fallback")).toBe("fallback");
    expect(() => store.set("k", 1)).not.toThrow();
    expect(() => store.remove("k")).not.toThrow();
  });
});
