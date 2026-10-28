import {
  addDays,
  eventEnd,
  eventStart,
  guessOutdoor,
  parseYmd,
  ymd,
  type CalEvent,
} from "@/lib/calendar-model";
import type { EventInput } from "@/lib/events";
import { hhmm } from "@/lib/format";

export type Draft = {
  title: string;
  day: string; // YYYY-MM-DD
  start: string; // HH:MM
  end: string;
  endDayOffset: number; // timed events that end on a later day
  allDay: boolean;
  allDayDays: number;
  accountId: string;
  calendarId: string;
  outdoor: boolean;
  outdoorTouched: boolean;
  location: string;
  description: string;
  guests: string[];
  sendUpdates: boolean;
  guestsCanInviteOthers: boolean;
  guestsCanSeeOtherGuests: boolean;
  guestsCanModify: boolean;
};

export function nextHalfHour(now: Date): Date {
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
  return d;
}

export function newDraft(at: Date, cal: { accountId: string; calendarId: string }, until?: Date): Draft {
  const end = until ?? new Date(at.getTime() + 3600_000);
  return {
    title: "",
    day: ymd(at),
    start: hhmm(at),
    end: hhmm(end),
    endDayOffset: ymd(end) === ymd(at) ? 0 : 1,
    allDay: false,
    allDayDays: 1,
    ...cal,
    outdoor: false,
    outdoorTouched: false,
    location: "",
    description: "",
    guests: [],
    sendUpdates: true,
    guestsCanInviteOthers: true,
    guestsCanSeeOtherGuests: true,
    guestsCanModify: false,
  };
}

export function draftFromEvent(e: CalEvent, keywords: string[]): Draft {
  const s = eventStart(e);
  const en = eventEnd(e);
  const dayMs = 86_400_000;
  return {
    title: e.title,
    day: ymd(s),
    start: e.allDay ? "09:00" : hhmm(s),
    end: e.allDay ? "10:00" : hhmm(en),
    endDayOffset: e.allDay
      ? 0
      : Math.round((parseYmd(ymd(en)).getTime() - parseYmd(ymd(s)).getTime()) / dayMs),
    allDay: e.allDay,
    allDayDays: e.allDay ? Math.max(1, Math.round((en.getTime() - s.getTime()) / dayMs)) : 1,
    accountId: e.accountId,
    calendarId: e.calendarId,
    outdoor: e.outdoor ?? guessOutdoor(e.title, keywords),
    outdoorTouched: e.outdoor !== null,
    location: e.location ?? "",
    description: e.description ?? "",
    guests: e.attendees.filter((a) => !a.self).map((a) => a.email),
    sendUpdates: true,
    guestsCanInviteOthers: e.guestsCanInviteOthers,
    guestsCanSeeOtherGuests: e.guestsCanSeeOtherGuests,
    guestsCanModify: e.guestsCanModify,
  };
}

export function draftTimes(d: Draft): { start: Date; end: Date } {
  const day = parseYmd(d.day);
  if (d.allDay) return { start: day, end: addDays(day, d.allDayDays) };
  const [sh, sm] = d.start.split(":").map(Number);
  const [eh, em] = d.end.split(":").map(Number);
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), sh, sm);
  let end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + d.endDayOffset, eh, em);
  if (end <= start) end = new Date(end.getTime() + 86_400_000); // e.g. 11 PM → 1 AM
  return { start, end };
}

export function draftToInput(d: Draft, guestsChanged: boolean): EventInput {
  const { start, end } = draftTimes(d);
  return {
    title: d.title.trim(),
    start: d.allDay ? ymd(start) : start.toISOString(),
    end: d.allDay ? ymd(end) : end.toISOString(),
    allDay: d.allDay,
    location: d.location.trim(),
    description: d.description,
    outdoor: d.outdoor,
    guests: d.guests,
    sendUpdates: guestsChanged ? d.sendUpdates : false,
    guestsCanInviteOthers: d.guestsCanInviteOthers,
    guestsCanSeeOtherGuests: d.guestsCanSeeOtherGuests,
    guestsCanModify: d.guestsCanModify,
  };
}

// Apply a draft to an event for the optimistic update.
export function applyDraft(base: CalEvent, d: Draft): CalEvent {
  const input = draftToInput(d, false);
  return {
    ...base,
    title: input.title,
    start: input.start,
    end: input.end,
    allDay: input.allDay,
    location: input.location,
    description: input.description,
    outdoor: input.outdoor,
    accountId: d.accountId,
    calendarId: d.calendarId,
    attendees: d.guests.map(
      (email) => base.attendees.find((a) => a.email === email) ?? { email, status: "needsAction" },
    ),
  };
}
