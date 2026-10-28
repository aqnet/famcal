// Pure calendar logic shared by the server and the display. No Node or browser APIs here.

export type RsvpStatus = "accepted" | "declined" | "tentative" | "needsAction";

export type Attendee = {
  email: string;
  name?: string;
  status: RsvpStatus;
  self?: boolean;
  organizer?: boolean;
};

export type CalEvent = {
  key: string; // de-duplication key: iCalUID + occurrence start (FR-54)
  id: string;
  accountId: string; // account the event is edited through
  calendarId: string;
  accountIds: string[]; // every connected account that has this event
  title: string;
  start: string; // ISO date-time, or YYYY-MM-DD for all-day
  end: string; // exclusive
  allDay: boolean;
  location?: string;
  description?: string;
  recurringEventId?: string;
  outdoor: boolean | null; // stored flag, or null when never set (the display guesses from keywords)
  busy: boolean; // private event on a non-family account: no details (FR-53)
  canEdit: boolean;
  canRsvp: boolean; // a connected account is a guest, not the organiser (FR-64)
  organizerSelf: boolean;
  attendees: Attendee[];
  guestsCanInviteOthers: boolean;
  guestsCanSeeOtherGuests: boolean;
  guestsCanModify: boolean;
};

// The subset of a Google Calendar event resource we read.
export type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  recurringEventId?: string;
  originalStartTime?: { date?: string; dateTime?: string };
  iCalUID?: string;
  visibility?: string;
  organizer?: { email?: string; self?: boolean };
  attendees?: {
    email?: string;
    displayName?: string;
    responseStatus?: string;
    self?: boolean;
    organizer?: boolean;
  }[];
  guestsCanInviteOthers?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  guestsCanModify?: boolean;
  extendedProperties?: { private?: Record<string, string> };
};

export const OUTDOOR_PROP = "famcalOutdoor";

export function normalizeEvent(
  raw: GoogleEvent,
  ctx: { accountId: string; calendarId: string; accessRole: string; isFamily: boolean },
): CalEvent | null {
  if (raw.status === "cancelled" || !raw.start || !raw.end) return null;
  const allDay = !!raw.start.date;
  const start = raw.start.date ?? raw.start.dateTime;
  const end = raw.end.date ?? raw.end.dateTime;
  if (!start || !end) return null;

  const busy = raw.visibility === "private" && !ctx.isFamily;
  const attendees: Attendee[] = (raw.attendees ?? [])
    .filter((a) => a.email)
    .map((a) => ({
      email: a.email!,
      name: a.displayName,
      status: (["accepted", "declined", "tentative"].includes(a.responseStatus ?? "")
        ? a.responseStatus
        : "needsAction") as RsvpStatus,
      self: a.self || undefined,
      organizer: a.organizer || undefined,
    }));
  const selfAttendee = attendees.find((a) => a.self);
  // No organizer block (or a calendar-owned event) means the calendar owns it.
  const organizerSelf = raw.organizer ? !!raw.organizer.self : true;
  const writable = ctx.accessRole === "owner" || ctx.accessRole === "writer";
  const guestsCanModify = raw.guestsCanModify ?? false;
  const flag = raw.extendedProperties?.private?.[OUTDOOR_PROP];
  const original = raw.originalStartTime?.dateTime ?? raw.originalStartTime?.date ?? start;

  return {
    key: `${raw.iCalUID ?? raw.id}|${original}`,
    id: raw.id,
    accountId: ctx.accountId,
    calendarId: ctx.calendarId,
    accountIds: [ctx.accountId],
    title: busy ? "Busy" : raw.summary?.trim() || "(No title)",
    start,
    end,
    allDay,
    location: busy ? undefined : raw.location,
    description: busy ? undefined : raw.description,
    recurringEventId: raw.recurringEventId,
    outdoor: flag === "1" ? true : flag === "0" ? false : null,
    busy,
    canEdit: !busy && writable && (organizerSelf || guestsCanModify),
    canRsvp: !busy && writable && !organizerSelf && !!selfAttendee,
    organizerSelf,
    attendees: busy ? [] : attendees,
    guestsCanInviteOthers: raw.guestsCanInviteOthers ?? true,
    guestsCanSeeOtherGuests: raw.guestsCanSeeOtherGuests ?? true,
    guestsCanModify,
  };
}

// Merge copies of the same occurrence seen through several accounts (FR-54). The organiser's copy
// wins, so edits go through the organiser's account when it is connected.
export function dedupeEvents(events: CalEvent[], familyAccountId?: string): CalEvent[] {
  const byKey = new Map<string, CalEvent>();
  const rank = (e: CalEvent) => (e.organizerSelf ? 2 : 0) + (e.accountId === familyAccountId ? 1 : 0);
  for (const e of events) {
    const existing = byKey.get(e.key);
    if (!existing) {
      byKey.set(e.key, e);
      continue;
    }
    const accountIds = Array.from(new Set([...existing.accountIds, ...e.accountIds]));
    const winner = rank(e) > rank(existing) ? e : existing;
    byKey.set(e.key, { ...winner, accountIds });
  }
  return Array.from(byKey.values());
}

export function guessOutdoor(title: string, keywords: string[]): boolean {
  const words = title.toLowerCase();
  return keywords.some(
    (k) => k.trim() && new RegExp(`\\b${escapeRegExp(k.trim().toLowerCase())}`).test(words),
  );
}

export function isOutdoor(e: CalEvent, keywords: string[]): boolean {
  return e.outdoor ?? guessOutdoor(e.title, keywords);
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---- Dates (local time; the display shows the iPad's own time zone) ----

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
}

export function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  return addDays(day, -day.getDay()); // weeks start on Sunday
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function eventStart(e: CalEvent): Date {
  return e.allDay ? parseYmd(e.start) : new Date(e.start);
}

export function eventEnd(e: CalEvent): Date {
  return e.allDay ? parseYmd(e.end) : new Date(e.end);
}

// Sunday-first grid covering the month (5 or 6 rows).
export function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const rows = Math.ceil((first.getDay() + daysInMonth) / 7);
  return Array.from({ length: rows * 7 }, (_, i) => addDays(start, i));
}

// ---- Week layout ----

const DAY_MS = 86_400_000;

// All-day row: all-day events plus timed events of 24 h or more (visualdesign.md).
export function isAllDayRow(e: CalEvent): boolean {
  return e.allDay || eventEnd(e).getTime() - eventStart(e).getTime() >= DAY_MS;
}

export type TimedPlacement = {
  event: CalEvent;
  startMin: number; // minutes from local midnight for this day's segment
  endMin: number;
  col: number;
  cols: number;
};

export type DayLayout = {
  placements: TimedPlacement[];
  overflow: { startMin: number; endMin: number; count: number }[];
};

// Lay out one day's timed events: overlapping events share the column width, up to `maxCols`;
// the rest of each overlapping group collapses into a "+N" chip. Events crossing midnight are split.
export function layoutDay(events: CalEvent[], day: Date, maxCols = 3): DayLayout {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = addDays(startOfDay(day), 1).getTime();
  const segments = events
    .filter((e) => !isAllDayRow(e))
    .map((e) => {
      const s = Math.max(eventStart(e).getTime(), dayStart);
      const en = Math.min(eventEnd(e).getTime(), dayEnd);
      return { event: e, startMin: (s - dayStart) / 60_000, endMin: (en - dayStart) / 60_000 };
    })
    .filter(
      (s) =>
        s.endMin > s.startMin ||
        (s.endMin === s.startMin &&
          eventStart(s.event).getTime() >= dayStart &&
          eventStart(s.event).getTime() < dayEnd),
    )
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const placements: TimedPlacement[] = [];
  const overflow: DayLayout["overflow"] = [];
  let group: typeof segments = [];
  let groupEnd = -1;

  const flush = () => {
    if (!group.length) return;
    const colEnds: number[] = [];
    const placed: { seg: (typeof segments)[number]; col: number }[] = [];
    const hidden: typeof segments = [];
    for (const seg of group) {
      // treat zero-length events as 15 minutes for overlap purposes
      const end = Math.max(seg.endMin, seg.startMin + 15);
      let col = colEnds.findIndex((e) => e <= seg.startMin);
      if (col === -1) col = colEnds.length;
      if (col >= maxCols) {
        hidden.push(seg);
        continue;
      }
      colEnds[col] = end;
      placed.push({ seg, col });
    }
    const cols = Math.min(Math.max(colEnds.length, 1), maxCols);
    for (const { seg, col } of placed) placements.push({ ...seg, col, cols });
    if (hidden.length) {
      overflow.push({
        startMin: Math.min(...hidden.map((h) => h.startMin)),
        endMin: Math.max(...hidden.map((h) => Math.max(h.endMin, h.startMin + 15))),
        count: hidden.length,
      });
    }
    group = [];
    groupEnd = -1;
  };

  for (const seg of segments) {
    if (group.length && seg.startMin >= groupEnd) flush();
    group.push(seg);
    groupEnd = Math.max(groupEnd, Math.max(seg.endMin, seg.startMin + 15));
  }
  flush();
  return { placements, overflow };
}

export type AllDayBar = { event: CalEvent; fromCol: number; toCol: number; row: number };

// Pack all-day bars for a run of days into rows; bars beyond `maxRows` are counted per day ("+N").
export function layoutAllDay(
  events: CalEvent[],
  firstDay: Date,
  days: number,
  maxRows = 2,
): { bars: AllDayBar[]; hiddenPerDay: number[] } {
  const start = startOfDay(firstDay).getTime();
  const items = events
    .filter(isAllDayRow)
    .map((e) => {
      const s = eventStart(e).getTime();
      const en = eventEnd(e).getTime();
      const fromCol = Math.max(0, Math.floor((s - start) / DAY_MS));
      const toCol = Math.min(days - 1, Math.ceil((en - start) / DAY_MS) - 1);
      return { event: e, fromCol, toCol };
    })
    .filter((b) => b.toCol >= 0 && b.fromCol <= days - 1 && b.toCol >= b.fromCol)
    .sort((a, b) => a.fromCol - b.fromCol || b.toCol - b.fromCol - (a.toCol - a.fromCol));

  const rowEnds: number[] = [];
  const bars: AllDayBar[] = [];
  const hiddenPerDay = Array(days).fill(0) as number[];
  for (const item of items) {
    let row = rowEnds.findIndex((end) => end < item.fromCol);
    if (row === -1) row = rowEnds.length;
    if (row >= maxRows) {
      for (let c = item.fromCol; c <= item.toCol; c++) hiddenPerDay[c]++;
      continue;
    }
    rowEnds[row] = item.toCol;
    bars.push({ ...item, row });
  }
  return { bars, hiddenPerDay };
}
