import "server-only";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { DEFAULT_CALENDAR_COLORS } from "@/lib/colors";

const API = "https://www.googleapis.com/calendar/v3";
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

export type Account = {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  isFamily: boolean;
  status: "ok" | "reconnect";
};

export type CalendarRow = {
  accountId: string;
  calendarId: string;
  summary: string;
  accessRole: string;
  isPrimary: boolean;
  color: string;
  selected: boolean;
};

export class GoogleAuthError extends Error {}
export class GoogleApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function authUrl(origin: string, state: string, loginHint?: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env("GOOGLE_CLIENT_ID"));
  url.searchParams.set("redirect_uri", `${origin}/api/google/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  // consent every time so Google always returns a refresh token
  url.searchParams.set("prompt", "consent select_account");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  return url.toString();
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      ...body,
    }),
    cache: "no-store",
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
  };
  return { ok: res.ok, json };
}

export async function exchangeCode(origin: string, code: string) {
  const { ok, json } = await tokenRequest({
    code,
    grant_type: "authorization_code",
    redirect_uri: `${origin}/api/google/callback`,
  });
  if (!ok || !json.access_token) throw new GoogleAuthError(json.error ?? "token exchange failed");
  return { ...json, access_token: json.access_token };
}

// Access tokens are cached per server instance; refresh tokens live encrypted in the database.
const accessTokens = new Map<string, { token: string; expires: number }>();

export async function accessToken(accountId: string): Promise<string> {
  const cached = accessTokens.get(accountId);
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;

  const [row] = await db()<{ refresh_token_enc: string }[]>`
    select refresh_token_enc from famcal.google_accounts where id = ${accountId}`;
  if (!row) throw new GoogleAuthError("account not found");

  const { ok, json } = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: decrypt(row.refresh_token_enc),
  });
  if (!ok || !json.access_token) {
    if (json.error === "invalid_grant") {
      await db()`update famcal.google_accounts set status = 'reconnect' where id = ${accountId}`;
    }
    throw new GoogleAuthError(json.error ?? "refresh failed");
  }
  await db()`update famcal.google_accounts set status = 'ok' where id = ${accountId} and status <> 'ok'`;
  accessTokens.set(accountId, {
    token: json.access_token,
    expires: Date.now() + (json.expires_in ?? 3600) * 1000,
  });
  return json.access_token;
}

// Calendar API call as one connected account.
export async function gcal<T>(
  accountId: string,
  path: string,
  init: { method?: string; query?: Record<string, string | undefined>; body?: unknown } = {},
): Promise<T> {
  const token = await accessToken(accountId);
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (res.status === 401) {
    accessTokens.delete(accountId);
    throw new GoogleAuthError("unauthorized");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new GoogleApiError(res.status, text.slice(0, 500));
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export async function userInfo(token: string) {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new GoogleAuthError("userinfo failed");
  return (await res.json()) as { email: string; name?: string; picture?: string };
}

export async function revoke(accountId: string) {
  const [row] = await db()<{ refresh_token_enc: string }[]>`
    select refresh_token_enc from famcal.google_accounts where id = ${accountId}`;
  if (!row) return;
  await fetch(
    `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(row.refresh_token_enc))}`,
    {
      method: "POST",
    },
  ).catch(() => undefined);
  accessTokens.delete(accountId);
}

export async function listAccounts(): Promise<Account[]> {
  return db()<Account[]>`
    select id, email, name, picture, is_family as "isFamily", status
    from famcal.google_accounts order by sort, created_at`;
}

export async function listCalendars(): Promise<CalendarRow[]> {
  return db()<CalendarRow[]>`
    select c.account_id as "accountId", c.calendar_id as "calendarId", c.summary, c.access_role as "accessRole",
           c.is_primary as "isPrimary", c.color, c.selected
    from famcal.calendars c join famcal.google_accounts a on a.id = c.account_id
    order by a.sort, a.created_at, c.is_primary desc, c.summary`;
}

type GoogleCalendarListEntry = {
  id: string;
  summary: string;
  summaryOverride?: string;
  accessRole: string;
  primary?: boolean;
};

// Save a newly connected account and pull its calendar list (primary calendar shown by default).
export async function saveAccount(tokens: { access_token: string; refresh_token?: string }) {
  const info = await userInfo(tokens.access_token);
  const sql = db();
  const [{ count }] = await sql<
    { count: number }[]
  >`select count(*)::int as count from famcal.google_accounts`;
  const isFamily = count === 0;

  let accountId: string;
  if (tokens.refresh_token) {
    const [row] = await sql<{ id: string }[]>`
      insert into famcal.google_accounts (email, name, picture, refresh_token_enc, is_family, sort)
      values (${info.email}, ${info.name ?? null}, ${info.picture ?? null}, ${encrypt(tokens.refresh_token)}, ${isFamily}, ${count})
      on conflict (email) do update set name = excluded.name, picture = excluded.picture,
        refresh_token_enc = excluded.refresh_token_enc, status = 'ok'
      returning id`;
    accountId = row.id;
  } else {
    const [row] = await sql<
      { id: string }[]
    >`select id from famcal.google_accounts where email = ${info.email}`;
    if (!row) throw new GoogleAuthError("Google did not return a refresh token");
    accountId = row.id;
  }
  accessTokens.set(accountId, { token: tokens.access_token, expires: Date.now() + 3000 * 1000 });

  await syncCalendars(accountId);
  return { accountId, email: info.email };
}

// Pull an account's calendar list from Google. New calendars get the next free colour and are hidden
// unless primary; existing ones keep the colour and visibility chosen in Settings.
export async function syncCalendars(accountId: string) {
  const sql = db();
  const list = await gcal<{ items: GoogleCalendarListEntry[] }>(accountId, "/users/me/calendarList", {
    query: { maxResults: "250" },
  });
  const existing = await sql<{ account_id: string; calendar_id: string; color: string }[]>`
    select account_id, calendar_id, color from famcal.calendars`;
  const known = new Set(existing.filter((r) => r.account_id === accountId).map((r) => r.calendar_id));
  const used = new Set(existing.map((r) => r.color));
  for (const cal of list.items) {
    let color = DEFAULT_CALENDAR_COLORS[0];
    if (!known.has(cal.id)) {
      color = DEFAULT_CALENDAR_COLORS.find((c) => !used.has(c)) ?? DEFAULT_CALENDAR_COLORS[0];
      used.add(color);
    }
    await sql`
      insert into famcal.calendars (account_id, calendar_id, summary, access_role, is_primary, color, selected)
      values (${accountId}, ${cal.id}, ${cal.summaryOverride ?? cal.summary}, ${cal.accessRole}, ${!!cal.primary}, ${color}, ${!!cal.primary})
      on conflict (account_id, calendar_id) do update set summary = excluded.summary, access_role = excluded.access_role,
        is_primary = excluded.is_primary`;
  }
}

// Why connecting an account failed, as a short code for the ?google= query parameter.
export function connectFailure(err: unknown): string {
  if (
    err instanceof GoogleApiError &&
    err.status === 403 &&
    /has not been used|is disabled/.test(err.message)
  ) {
    return "api-disabled";
  }
  if (err instanceof GoogleAuthError) return "auth";
  return "error";
}
