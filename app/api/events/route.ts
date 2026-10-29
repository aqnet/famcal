import { NextResponse, type NextRequest } from "next/server";
import { requireMemberApi } from "@/lib/auth";
import {
  createEvent,
  deleteEvent,
  eventGuests,
  knownGuestEmails,
  listEvents,
  rescheduleEvent,
  rsvp,
  updateEvent,
  type EventInput,
  type EventRef,
} from "@/lib/events";
import { pinUnlocked } from "@/lib/pin";
import { GoogleApiError, GoogleAuthError } from "@/lib/google";
import type { RsvpStatus } from "@/lib/calendar-model";

export const dynamic = "force-dynamic";

const MAX_RANGE_DAYS = 62;

export async function GET(request: NextRequest) {
  const member = await requireMemberApi();
  if (member instanceof NextResponse) return member;
  const timeMin = request.nextUrl.searchParams.get("timeMin");
  const timeMax = request.nextUrl.searchParams.get("timeMax");
  const span = Date.parse(timeMax ?? "") - Date.parse(timeMin ?? "");
  if (!timeMin || !timeMax || !(span > 0) || span > MAX_RANGE_DAYS * 86_400_000) {
    return NextResponse.json({ error: "bad_range" }, { status: 400 });
  }
  return NextResponse.json(
    await listEvents(new Date(timeMin).toISOString(), new Date(timeMax).toISOString()),
  );
}

type Body =
  | { action: "create"; accountId: string; calendarId: string; event: EventInput }
  | { action: "update"; ref: EventRef; event: EventInput; scope: "this" | "all" }
  | { action: "delete"; ref: EventRef; scope: "this" | "all"; notify?: boolean }
  | { action: "rsvp"; ref: EventRef; status: RsvpStatus }
  | { action: "reschedule"; ref: EventRef; start: string; end: string; scope: "this" | "all" };

function validInput(e: EventInput | undefined): e is EventInput {
  if (!e || typeof e.title !== "string" || !e.title.trim() || typeof e.allDay !== "boolean") return false;
  const ok = e.allDay
    ? /^\d{4}-\d{2}-\d{2}$/.test(e.start) && /^\d{4}-\d{2}-\d{2}$/.test(e.end) && e.end > e.start
    : Date.parse(e.end) > Date.parse(e.start);
  const reminder =
    e.reminder == null || (Number.isInteger(e.reminder) && e.reminder >= 0 && e.reminder <= 40320); // Google's cap: 4 weeks
  return (
    ok &&
    reminder &&
    (!e.guests || (Array.isArray(e.guests) && e.guests.every((g) => /^[^\s@]+@[^\s@]+$/.test(g))))
  );
}

// Typed addresses outside family and recent guests need the PIN (FR-60).
async function guestsAllowed(userId: string, guests: string[] | undefined, existing: string[] = []) {
  if (!guests?.length) return true;
  const known = await knownGuestEmails();
  existing.forEach((e) => known.add(e));
  return guests.every((g) => known.has(g.toLowerCase())) || (await pinUnlocked(userId));
}

export async function POST(request: NextRequest) {
  const member = await requireMemberApi();
  if (member instanceof NextResponse) return member;
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  try {
    switch (body.action) {
      case "create": {
        if (!validInput(body.event)) return NextResponse.json({ error: "invalid_event" }, { status: 400 });
        if (!(await guestsAllowed(member.userId, body.event.guests))) {
          return NextResponse.json({ error: "pin_required" }, { status: 403 });
        }
        const created = await createEvent(body.accountId, body.calendarId, body.event);
        return NextResponse.json({ id: created.id });
      }
      case "update": {
        if (!validInput(body.event)) return NextResponse.json({ error: "invalid_event" }, { status: 400 });
        const existing = body.event.guests ? await eventGuests(body.ref) : [];
        if (!(await guestsAllowed(member.userId, body.event.guests, existing))) {
          return NextResponse.json({ error: "pin_required" }, { status: 403 });
        }
        await updateEvent(body.ref, body.event, body.scope);
        return NextResponse.json({ ok: true });
      }
      case "reschedule": {
        const s = Date.parse(body.start);
        const e = Date.parse(body.end);
        if (!(e > s) || e - s > 7 * 86_400_000) {
          return NextResponse.json({ error: "invalid_event" }, { status: 400 });
        }
        await rescheduleEvent(body.ref, new Date(s).toISOString(), new Date(e).toISOString(), body.scope);
        return NextResponse.json({ ok: true });
      }
      case "delete":
        await deleteEvent(body.ref, body.scope, body.notify ?? true);
        return NextResponse.json({ ok: true });
      case "rsvp":
        if (!["accepted", "declined", "tentative"].includes(body.status)) {
          return NextResponse.json({ error: "bad_status" }, { status: 400 });
        }
        await rsvp(body.ref, body.status);
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: "bad_action" }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof GoogleAuthError) return NextResponse.json({ error: "reconnect" }, { status: 409 });
    if (err instanceof GoogleApiError) {
      console.error("calendar write", err.status, err.message);
      return NextResponse.json({ error: "google", status: err.status }, { status: 502 });
    }
    console.error("calendar write", err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
