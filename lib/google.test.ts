import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSql, type FakeSql } from "@/test/fake-sql";

let sql: FakeSql;
vi.mock("@/lib/db", () => ({ db: () => sql }));

const { encrypt } = await import("./crypto");
const { DEFAULT_CALENDAR_COLORS } = await import("./colors");
const { accessToken, connectFailure, gcal, GoogleApiError, GoogleAuthError, syncCalendars } =
  await import("./google");

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeAll(() => {
  process.env.FAMCAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.GOOGLE_CLIENT_ID = "client";
  process.env.GOOGLE_CLIENT_SECRET = "secret";
});
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  sql = fakeSql((q) =>
    q.text.includes("refresh_token_enc") ? [{ refresh_token_enc: encrypt("refresh-1") }] : [],
  );
});
afterEach(() => vi.unstubAllGlobals());

// Access tokens are cached per account for the life of the module, so each test uses its own id.
let n = 0;
const newAccount = () => `acc-${++n}`;

describe("accessToken", () => {
  it("refreshes once, then serves the cached token until it nears expiry", async () => {
    const id = newAccount();
    fetchMock.mockResolvedValueOnce(json({ access_token: "tok", expires_in: 3600 }));
    expect(await accessToken(id)).toBe("tok");
    expect(await accessToken(id)).toBe("tok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as URLSearchParams);
    expect(body.get("refresh_token")).toBe("refresh-1");
    expect(body.get("grant_type")).toBe("refresh_token");
  });

  it("flags the account for reconnecting when Google revoked the refresh token", async () => {
    const id = newAccount();
    fetchMock.mockResolvedValueOnce(json({ error: "invalid_grant" }, 400));
    await expect(accessToken(id)).rejects.toBeInstanceOf(GoogleAuthError);
    const [flag] = sql.find("set status = 'reconnect'");
    expect(flag.values).toEqual([id]);
  });

  it("doesn't flag the account for a passing failure", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "temporarily_unavailable" }, 503));
    await expect(accessToken(newAccount())).rejects.toBeInstanceOf(GoogleAuthError);
    expect(sql.find("'reconnect'")).toHaveLength(0);
  });

  it("fails as an auth error for an unknown account", async () => {
    sql = fakeSql(() => []);
    await expect(accessToken(newAccount())).rejects.toThrow("account not found");
  });
});

describe("gcal", () => {
  async function withToken() {
    const id = newAccount();
    fetchMock.mockResolvedValueOnce(json({ access_token: `tok-${id}`, expires_in: 3600 }));
    await accessToken(id);
    return id;
  }

  it("sends the bearer token and skips undefined query values", async () => {
    const id = await withToken();
    fetchMock.mockResolvedValueOnce(json({ items: [] }));
    await gcal(id, "/calendars/x/events", { query: { a: "1", pageToken: undefined } });
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toBe("https://www.googleapis.com/calendar/v3/calendars/x/events?a=1");
    expect(init.headers.authorization).toBe(`Bearer tok-${id}`);
  });

  it("drops the cached token on 401 so the next call refreshes", async () => {
    const id = await withToken();
    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
    await expect(gcal(id, "/x")).rejects.toBeInstanceOf(GoogleAuthError);
    fetchMock.mockResolvedValueOnce(json({ access_token: "fresh", expires_in: 3600 }));
    expect(await accessToken(id)).toBe("fresh");
  });

  it("reports other failures with their status", async () => {
    const id = await withToken();
    fetchMock.mockResolvedValueOnce(new Response("quota", { status: 429 }));
    await expect(gcal(id, "/x")).rejects.toMatchObject({ status: 429, message: "quota" });
  });

  it("returns nothing for 204", async () => {
    const id = await withToken();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await gcal(id, "/x", { method: "DELETE" })).toBeUndefined();
  });
});

describe("syncCalendars", () => {
  it("gives new calendars the next free colour, shows only the primary, and leaves existing ones alone", async () => {
    const id = newAccount();
    sql = fakeSql((q) =>
      q.text.includes("refresh_token_enc")
        ? [{ refresh_token_enc: encrypt("r") }]
        : q.text.startsWith("select account_id, calendar_id, color")
          ? [
              { account_id: id, calendar_id: "known", color: DEFAULT_CALENDAR_COLORS[0] },
              { account_id: "other", calendar_id: "x", color: DEFAULT_CALENDAR_COLORS[1] },
            ]
          : [],
    );
    fetchMock.mockResolvedValueOnce(json({ access_token: "t", expires_in: 3600 })).mockResolvedValueOnce(
      json({
        items: [
          { id: "known", summary: "Known", accessRole: "owner" },
          { id: "me@example.com", summary: "Me", accessRole: "owner", primary: true },
          { id: "kids", summary: "Kids", summaryOverride: "Kids activities", accessRole: "writer" },
        ],
      }),
    );
    await syncCalendars(id);
    const inserts = sql.find("insert into famcal.calendars").map((q) => q.values);
    // values: account, calendar, summary, role, primary, colour, selected
    expect(inserts.map((v) => [v[1], v[2], v[5], v[6]])).toEqual([
      ["known", "Known", DEFAULT_CALENDAR_COLORS[0], false],
      ["me@example.com", "Me", DEFAULT_CALENDAR_COLORS[2], true],
      ["kids", "Kids activities", DEFAULT_CALENDAR_COLORS[3], false],
    ]);
    // Existing rows keep their colour and visibility: the upsert only refreshes name, role, primary.
    expect(sql.find("on conflict (account_id, calendar_id) do update set summary")[0].text).not.toMatch(
      /color = excluded|selected = excluded/,
    );
  });
});

describe("connectFailure", () => {
  it("names the Calendar API being off, auth problems, and anything else", () => {
    expect(connectFailure(new GoogleApiError(403, "Calendar API has not been used in project"))).toBe(
      "api-disabled",
    );
    expect(connectFailure(new GoogleApiError(403, "insufficient permissions"))).toBe("error");
    expect(connectFailure(new GoogleAuthError("x"))).toBe("auth");
    expect(connectFailure(new Error("x"))).toBe("error");
  });
});
