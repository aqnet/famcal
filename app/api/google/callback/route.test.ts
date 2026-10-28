import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

let member: { userId: string; email: string } | NextResponse;
vi.mock("@/lib/auth", () => ({ requireMemberApi: async () => member }));
vi.mock("@/lib/google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/google")>()),
  exchangeCode: vi.fn(async () => ({ access_token: "a", refresh_token: "r" })),
  saveAccount: vi.fn(async () => ({ accountId: "acc", email: "x@example.com" })),
}));
const google = await import("@/lib/google");
const { GET } = await import("./route");

const callback = (qs: string, state?: string) => {
  const req = new NextRequest(`http://localhost:3000/api/google/callback?${qs}`);
  if (state) req.cookies.set("famcal_oauth_state", state);
  return GET(req);
};
const result = (res: Response) => new URL(res.headers.get("location")!).searchParams.get("google");

beforeEach(() => {
  vi.clearAllMocks();
  member = { userId: "user-a", email: "a@example.com" };
});
afterEach(() => {
  delete process.env.APP_ORIGIN;
});

describe("Google OAuth callback", () => {
  it("connects the account when the state matches", async () => {
    const res = await callback("code=c1&state=s1", "s1");
    expect(result(res)).toBe("connected");
    expect(google.exchangeCode).toHaveBeenCalledWith("http://localhost:3000", "c1");
    expect(google.saveAccount).toHaveBeenCalled();
    // The one-time state cookie is cleared.
    expect(res.headers.get("set-cookie")).toMatch(/famcal_oauth_state=;/);
  });

  it("refuses a missing or mismatched state (CSRF), without using the code", async () => {
    expect(result(await callback("code=c1&state=s1"))).toBe("state");
    expect(result(await callback("code=c1&state=attacker", "s1"))).toBe("state");
    expect(google.exchangeCode).not.toHaveBeenCalled();
  });

  it("says when the user declined", async () => {
    expect(result(await callback("error=access_denied&state=s1", "s1"))).toBe("denied");
  });

  it("explains a Calendar API that's turned off", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(google.saveAccount).mockRejectedValueOnce(
      new google.GoogleApiError(403, "Google Calendar API has not been used in project 123"),
    );
    expect(result(await callback("code=c1&state=s1", "s1"))).toBe("api-disabled");
  });

  it("redirects to the public origin and uses it for the redirect URI", async () => {
    process.env.APP_ORIGIN = "https://famcal.example.com";
    const res = await callback("code=c1&state=s1", "s1");
    expect(res.headers.get("location")).toBe("https://famcal.example.com/?google=connected");
    expect(google.exchangeCode).toHaveBeenCalledWith("https://famcal.example.com", "c1");
  });

  it("is for members only", async () => {
    member = NextResponse.json({ error: "forbidden" }, { status: 403 });
    expect((await callback("code=c1&state=s1", "s1")).status).toBe(403);
    expect(google.exchangeCode).not.toHaveBeenCalled();
  });
});
