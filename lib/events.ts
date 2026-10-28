import "server-only";
import {
  dedupeEvents,
  normalizeEvent,
  OUTDOOR_PROP,
  type CalEvent,
  type GoogleEvent,
  type RsvpStatus,
} from "@/lib/calendar-model";
import { db } from "@/lib/db";
import {
  gcal,
  GoogleApiError,
  GoogleAuthError,
  listAccounts,
  listCalendars,
  type Account,
  type CalendarRow,
} from "@/lib/google";
import { getCache, getHousehold, setCache } from "@/lib/household";

export type EventsResponse = {
  events: CalEvent[];
  accounts: Account[];
  calendars: CalendarRow[];
  failedAccounts: string[];
  syncedAt: string;
};

const RECENT_GUESTS = "recent_guests";

// Fetch events for every selected calendar on every connected account (FR-10, FR-16, FR-19).
// Events are not cached on the server; the display polls every 60 s.
export async function listEvents(timeMin: string, timeMax: string): Promise<EventsResponse> {
  const [accounts, calendars] = await Promise.all([listAccounts(), listCalendars()]);
  const byAccount = new Map(accounts.map((a) => [a.id, a]));
  const family = accounts.find((a) => a.isFamily);
  const failed = new Set<string>();
  const seenGuests = new Set<string>();

  const lists = await Promise.all(
    calendars
      .filter((c) => c.selected && byAccount.has(c.accountId))
      .map(async (cal) => {
        try {
          const items: GoogleEvent[] = [];
          let pageToken: string | undefined;
          do {
            const page = await gcal<{ items?: GoogleEvent[]; nextPageToken?: string }>(
              cal.accountId,
              `/calendars/${encodeURIComponent(cal.calendarId)}/events`,
              {
                query: {
                  timeMin,
                  timeMax,
                  singleEvents: "true",
                  orderBy: "startTime",
                  maxResults: "2500",
                  pageToken,
                },
              },
            );
            items.push(...(page.items ?? []));
            pageToken = page.nextPageToken;
          } while (pageToken);
          const account = byAccount.get(cal.accountId)!;
          return items.flatMap((raw) => {
            raw.attendees?.forEach((a) => a.email && !a.self && seenGuests.add(a.email.toLowerCase()));
            const e = normalizeEvent(raw, {
              accountId: cal.accountId,
              calendarId: cal.calendarId,
              accessRole: cal.accessRole,
              isFamily: account.isFamily,
            });
            return e ? [e] : [];
          });
        } catch (err) {
          // One account failing never stops the others (FR-58).
          failed.add(cal.accountId);
          if (!(err instanceof GoogleAuthError)) console.error("events.list", cal.calendarId, err);
          return [];
        }
      }),
  );

  if (seenGuests.size) await rememberGuests([...seenGuests]);

  return {
    events: dedupeEvents(lists.flat(), family?.id),
    accounts: await listAccounts(), // re-read: a failed refresh may have flagged an account
    calendars,
    failedAccounts: [...failed],
    syncedAt: new Date().toISOString(),
  };
}

async function rememberGuests(emails: string[]) {
  const existing = (await getCache<string[]>(RECENT_GUESTS))?.value ?? [];
  const merged = Array.from(new Set([...emails, ...existing])).slice(0, 200);
  if (merged.length !== existing.length || merged.some((e, i) => e !== existing[i])) {
    await setCache(RECENT_GUESTS, merged, 90 * 86400);
  }
}

export async function recentGuests(): Promise<string[]> {
  return (await getCache<string[]>(RECENT_GUESTS))?.value ?? [];
}

// Addresses that need no PIN: family members and people already seen on events (FR-60).
export async function knownGuestEmails(): Promise<Set<string>> {
  const [household, recent] = await Promise.all([getHousehold(), recentGuests()]);
  return new Set([...household.familyMembers.map((m) => m.email.toLowerCase()), ...recent]);
}

export type EventInput = {
  title: string;
  start: string; // ISO date-time, or YYYY-MM-DD when allDay
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  outdoor: boolean;
  guests?: string[];
  sendUpdates?: boolean;
  guestsCanInviteOthers?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  guestsCanModify?: boolean;
};

export type EventRef = { accountId: string; calendarId: string; eventId: string; recurringEventId?: string };

export async function assertWritable(accountId: string, calendarId: string) {
  const [row] = await db()<{ access_role: string }[]>`
    select access_role from famcal.calendars where account_id = ${accountId} and calendar_id = ${calendarId}`;
  if (!row || !["owner", "writer"].includes(row.access_role)) throw new Error("calendar is not writable");
}

const eventPath = (calendarId: string, eventId?: string) =>
  `/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ""}`;

function timeFields(input: Pick<EventInput, "start" | "end" | "allDay">) {
  return input.allDay
    ? { start: { date: input.start, dateTime: null }, end: { date: input.end, dateTime: null } }
    : { start: { dateTime: input.start, date: null }, end: { dateTime: input.end, date: null } };
}

function mergeAttendees(current: GoogleEvent["attendees"], emails: string[] | undefined) {
  if (!emails) return undefined;
  const wanted = new Set(emails.map((e) => e.toLowerCase()));
  const kept = (current ?? []).filter(
    (a) => a.email && (wanted.has(a.email.toLowerCase()) || a.self || a.organizer),
  );
  const keptEmails = new Set(kept.map((a) => a.email!.toLowerCase()));
  return [...kept, ...[...wanted].filter((e) => !keptEmails.has(e)).map((email) => ({ email }))];
}

function bodyFrom(input: EventInput, current?: GoogleEvent) {
  return {
    summary: input.title.trim(),
    location: input.location ?? "",
    description: input.description ?? "",
    ...timeFields(input),
    attendees: mergeAttendees(current?.attendees, input.guests),
    guestsCanInviteOthers: input.guestsCanInviteOthers,
    guestsCanSeeOtherGuests: input.guestsCanSeeOtherGuests,
    guestsCanModify: input.guestsCanModify,
    extendedProperties: { private: { [OUTDOOR_PROP]: input.outdoor ? "1" : "0" } },
  };
}

const sendUpdates = (input: EventInput) => (input.guests && input.sendUpdates !== false ? "all" : "none");

export async function createEvent(accountId: string, calendarId: string, input: EventInput) {
  await assertWritable(accountId, calendarId);
  return gcal<GoogleEvent>(accountId, eventPath(calendarId), {
    method: "POST",
    query: { sendUpdates: sendUpdates(input) },
    body: bodyFrom(input),
  });
}

// Edit one occurrence, or the whole series ("All events", FR-14). For the series, a time change on
// the tapped occurrence shifts the series by the same amount.
export async function updateEvent(ref: EventRef, input: EventInput, scope: "this" | "all") {
  await assertWritable(ref.accountId, ref.calendarId);
  const instance = await gcal<GoogleEvent>(ref.accountId, eventPath(ref.calendarId, ref.eventId));

  if (scope === "all" && ref.recurringEventId) {
    const master = await gcal<GoogleEvent>(ref.accountId, eventPath(ref.calendarId, ref.recurringEventId));
    const body = bodyFrom(input, master) as Record<string, unknown>;
    body.start = shiftTime(
      master.start,
      instance.start,
      input.allDay ? { date: input.start } : { dateTime: input.start },
    );
    body.end = shiftTime(
      master.end,
      instance.end,
      input.allDay ? { date: input.end } : { dateTime: input.end },
    );
    return gcal<GoogleEvent>(ref.accountId, eventPath(ref.calendarId, ref.recurringEventId), {
      method: "PATCH",
      query: { sendUpdates: sendUpdates(input) },
      body,
    });
  }

  return gcal<GoogleEvent>(ref.accountId, eventPath(ref.calendarId, ref.eventId), {
    method: "PATCH",
    query: { sendUpdates: sendUpdates(input) },
    body: bodyFrom(input, instance),
  });
}

// Change only the times of a timed event (drag to resize on the grid). Unlike updateEvent, nothing else
// is sent, so the title, notes and guests can't be overwritten from the display's partial copy.
export async function rescheduleEvent(ref: EventRef, start: string, end: string, scope: "this" | "all") {
  await assertWritable(ref.accountId, ref.calendarId);
  const instance = await gcal<GoogleEvent>(ref.accountId, eventPath(ref.calendarId, ref.eventId));
  const at = (iso: string, was: When | undefined): When => ({
    dateTime: iso,
    date: null,
    timeZone: was?.timeZone,
  });

  if (scope === "all" && ref.recurringEventId) {
    const master = await gcal<GoogleEvent>(ref.accountId, eventPath(ref.calendarId, ref.recurringEventId));
    return gcal<GoogleEvent>(ref.accountId, eventPath(ref.calendarId, ref.recurringEventId), {
      method: "PATCH",
      query: { sendUpdates: "all" },
      body: {
        start: shiftTime(master.start, instance.start, at(start, instance.start)),
        end: shiftTime(master.end, instance.end, at(end, instance.end)),
      },
    });
  }

  return gcal<GoogleEvent>(ref.accountId, eventPath(ref.calendarId, ref.eventId), {
    method: "PATCH",
    query: { sendUpdates: "all" },
    body: { start: at(start, instance.start), end: at(end, instance.end) },
  });
}

type When = { date?: string | null; dateTime?: string | null; timeZone?: string };

// Move `master` by however far `to` is from `from`.
function shiftTime(master: When | undefined, from: When | undefined, to: When): When | undefined {
  if (!master) return master;
  const ms = (w: When | undefined) =>
    w?.dateTime ? Date.parse(w.dateTime) : w?.date ? Date.parse(`${w.date}T00:00:00Z`) : NaN;
  const delta = ms(to) - ms(from);
  if (!Number.isFinite(delta) || delta === 0) return master;
  if (master.date && to.date) {
    return { date: new Date(Date.parse(`${master.date}T00:00:00Z`) + delta).toISOString().slice(0, 10) };
  }
  if (master.dateTime && to.dateTime) {
    return {
      dateTime: new Date(Date.parse(master.dateTime) + delta).toISOString(),
      timeZone: master.timeZone,
    };
  }
  return to; // switching between all-day and timed: take the new value as-is
}

export async function deleteEvent(ref: EventRef, scope: "this" | "all", notify: boolean) {
  await assertWritable(ref.accountId, ref.calendarId);
  const id = scope === "all" && ref.recurringEventId ? ref.recurringEventId : ref.eventId;
  try {
    await gcal<void>(ref.accountId, eventPath(ref.calendarId, id), {
      method: "DELETE",
      query: { sendUpdates: notify ? "all" : "none" },
    });
  } catch (err) {
    // Already gone (deleted elsewhere): treat as done.
    if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) return;
    throw err;
  }
}

export async function rsvp(ref: EventRef, status: RsvpStatus) {
  const current = await gcal<GoogleEvent>(ref.accountId, eventPath(ref.calendarId, ref.eventId));
  const attendees = (current.attendees ?? []).map((a) => (a.self ? { ...a, responseStatus: status } : a));
  return gcal<GoogleEvent>(ref.accountId, eventPath(ref.calendarId, ref.eventId), {
    method: "PATCH",
    body: { attendees },
  });
}

export async function eventGuests(ref: EventRef): Promise<string[]> {
  const current = await gcal<GoogleEvent>(ref.accountId, eventPath(ref.calendarId, ref.eventId));
  return (current.attendees ?? []).flatMap((a) => (a.email ? [a.email.toLowerCase()] : []));
}
