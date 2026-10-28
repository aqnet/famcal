import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Supabase answers getUser() with whoever the test says is signed in, and may refresh the session
// cookie on the way, as the real client does when a token is near expiry.
let signedIn: { id: string } | null = null;
let refreshCookie = false;
vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: { cookies: { setAll: (c: { name: string; value: string; options?: object }[]) => void } },
  ) => ({
    auth: {
      getUser: async () => {
        if (refreshCookie)
          opts.cookies.setAll([{ name: "sb-session", value: "refreshed", options: { path: "/" } }]);
        return { data: { user: signedIn } };
      },
    },
  }),
}));

const { isPublicPath, updateSession } = await import("./proxy");

const req = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"));

beforeEach(() => {
  signedIn = null;
  refreshCookie = false;
});
afterEach(() => {
  delete process.env.APP_ORIGIN;
});

describe("without a session (FR-8)", () => {
  it("sends pages to the login screen, remembering where you were going", async () => {
    const res = await updateSession(req("/settings?tab=photos"));
    expect(res.status).toBe(307);
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("next")).toBe("/settings?tab=photos");
  });

  it("doesn't add next=/ for the home page", async () => {
    const res = await updateSession(req("/"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("redirects to the public origin behind Cloud Run", async () => {
    process.env.APP_ORIGIN = "https://famcal.example.com/";
    const res = await updateSession(req("/"));
    expect(res.headers.get("location")).toBe("https://famcal.example.com/login");
  });

  it("answers API calls with 401 JSON instead of a redirect", async () => {
    const res = await updateSession(req("/api/events?timeMin=x"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("lets the login, email-link and icon routes through", async () => {
    for (const path of [
      "/login",
      "/auth/confirm?token_hash=x",
      "/auth/reset",
      "/favicon.ico",
      "/apple-icon.png",
      "/manifest.webmanifest",
    ]) {
      const res = await updateSession(req(path));
      expect(res.headers.get("location"), path).toBeNull();
      expect(res.status, path).toBe(200);
    }
  });

  it("keeps a refreshed session cookie on the redirect", async () => {
    refreshCookie = true;
    const res = await updateSession(req("/settings"));
    expect(res.cookies.get("sb-session")?.value).toBe("refreshed");
  });
});

describe("with a session", () => {
  it("passes requests on, with the refreshed cookie", async () => {
    signedIn = { id: "user-a" };
    refreshCookie = true;
    const res = await updateSession(req("/api/events"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get("sb-session")?.value).toBe("refreshed");
  });
});

describe("isPublicPath", () => {
  it("doesn't open look-alike paths", () => {
    expect(isPublicPath("/loginx")).toBe(true); // prefix match: only ever a 404 page, no data
    expect(isPublicPath("/authorize")).toBe(false);
    expect(isPublicPath("/icon.svg/../api/events")).toBe(false);
    expect(isPublicPath("/api/config")).toBe(false);
  });
});
