import { NextResponse, type NextRequest } from "next/server";
import { requireMemberApi } from "@/lib/auth";
import { requirePinApi } from "@/lib/pin";
import { db } from "@/lib/db";
import { getHousehold, type FamilyMember, type PhotoSource } from "@/lib/household";
import { listAccounts, listCalendars, revoke, syncCalendars } from "@/lib/google";
import { geocodeZip } from "@/lib/weather";
import { resolveSource, SmugMugError } from "@/lib/smugmug";
import { isAllowedCalendarColor } from "@/lib/colors";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Everything here sits behind the PIN (FR-4).
async function guard() {
  const member = await requireMemberApi();
  if (member instanceof NextResponse) return member;
  return (await requirePinApi(member.userId)) ?? member;
}

export async function GET() {
  const member = await guard();
  if (member instanceof NextResponse) return member;
  // Refresh each account's calendar list on opening Settings, so newly shared calendars appear and an
  // account whose first sync failed recovers without signing in again. One account failing doesn't block.
  const connected = (await listAccounts()).filter((a) => a.status === "ok");
  await Promise.all(
    connected.map((a) => syncCalendars(a.id).catch((err) => console.error("calendar sync", a.email, err))),
  );
  const [household, accounts, calendars, members] = await Promise.all([
    getHousehold(),
    listAccounts(),
    listCalendars(),
    db()<{ userId: string; email: string; addedAt: Date }[]>`
      select user_id as "userId", email, added_at as "addedAt" from famcal.members order by added_at`,
  ]);
  return NextResponse.json({ household, accounts, calendars, members, me: member.userId });
}

type Patch = Partial<{
  weatherZip: string;
  units: "F" | "C";
  outdoorKeywords: string[];
  rotationSeconds: number;
  nightStart: string;
  nightEnd: string;
  familyMembers: FamilyMember[];
  photoSources: PhotoSource[];
}>;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@]+@[^\s@]+$/;

export async function PATCH(request: NextRequest) {
  const member = await guard();
  if (member instanceof NextResponse) return member;
  const p = (await request.json().catch(() => ({}))) as Patch;
  const sql = db();
  const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

  if (p.weatherZip !== undefined) {
    const place = await geocodeZip(p.weatherZip.trim());
    if (!place) return bad("Unknown ZIP code.");
    await sql`update famcal.household set weather_zip = ${place.zip}, weather_place = ${place.place},
      weather_lat = ${place.lat}, weather_lon = ${place.lon} where id = 1`;
  }
  if (p.units !== undefined) {
    if (p.units !== "F" && p.units !== "C") return bad("Units must be F or C.");
    await sql`update famcal.household set units = ${p.units} where id = 1`;
  }
  if (p.outdoorKeywords !== undefined) {
    const words = p.outdoorKeywords
      .map((w) => String(w).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 50);
    await sql`update famcal.household set outdoor_keywords = ${words} where id = 1`;
  }
  if (p.rotationSeconds !== undefined) {
    const s = Math.round(Number(p.rotationSeconds));
    if (!(s >= 5 && s <= 600)) return bad("Rotation must be 5–600 seconds.");
    await sql`update famcal.household set rotation_seconds = ${s} where id = 1`;
  }
  if (p.nightStart !== undefined || p.nightEnd !== undefined) {
    if ((p.nightStart && !TIME.test(p.nightStart)) || (p.nightEnd && !TIME.test(p.nightEnd)))
      return bad("Use HH:MM.");
    if (p.nightStart) await sql`update famcal.household set night_start = ${p.nightStart} where id = 1`;
    if (p.nightEnd) await sql`update famcal.household set night_end = ${p.nightEnd} where id = 1`;
  }
  if (p.familyMembers !== undefined) {
    const fam = p.familyMembers
      .map((m) => ({
        name: String(m.name ?? "").trim(),
        email: String(m.email ?? "")
          .trim()
          .toLowerCase(),
      }))
      .filter((m) => m.name && EMAIL.test(m.email))
      .slice(0, 20);
    await sql`update famcal.household set family_members = ${sql.json(fam)} where id = 1`;
  }
  if (p.photoSources !== undefined) {
    const sources = p.photoSources
      .filter((s) => /^[A-Za-z0-9]+$/.test(s.nodeId))
      .map((s) => ({
        url: String(s.url),
        nodeId: s.nodeId,
        name: String(s.name ?? ""),
        type: s.type === "Folder" ? "Folder" : "Album",
        directOnly: !!s.directOnly,
        keyword: s.keyword ? String(s.keyword).trim() : undefined,
        newest: s.newest ? Math.max(1, Math.min(5000, Math.round(Number(s.newest)))) : undefined,
        galleryCount: Number(s.galleryCount) || 0,
        photoCount: Number(s.photoCount) || 0,
      }))
      .slice(0, 10);
    await sql`update famcal.household set photo_sources = ${sql.json(sources)} where id = 1`;
  }
  await sql`update famcal.household set updated_at = now() where id = 1`;
  return NextResponse.json({ household: await getHousehold() });
}

type Action =
  | { action: "resolvePhotos"; url: string; directOnly?: boolean }
  | { action: "calendar"; accountId: string; calendarId: string; selected?: boolean; color?: string }
  | { action: "removeAccount"; accountId: string }
  | { action: "invite"; email: string }
  | { action: "removeMember"; userId: string };

export async function POST(request: NextRequest) {
  const member = await guard();
  if (member instanceof NextResponse) return member;
  const body = (await request.json().catch(() => null)) as Action | null;
  const sql = db();
  const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

  switch (body?.action) {
    case "resolvePhotos":
      try {
        return NextResponse.json({ source: await resolveSource(body.url, !!body.directOnly) });
      } catch (err) {
        return bad(err instanceof SmugMugError ? err.message : "Couldn't reach SmugMug.");
      }

    case "calendar": {
      if (body.color !== undefined && !isAllowedCalendarColor(body.color))
        return bad("That colour is reserved.");
      await sql`update famcal.calendars set
          selected = coalesce(${body.selected ?? null}::boolean, selected),
          color = coalesce(${body.color ?? null}, color)
        where account_id = ${body.accountId} and calendar_id = ${body.calendarId}`;
      return NextResponse.json({ calendars: await listCalendars() });
    }

    case "removeAccount": {
      // Revoke the token and drop the account and its calendars (FR-50).
      await revoke(body.accountId);
      await sql`delete from famcal.google_accounts where id = ${body.accountId}`;
      const [first] = await sql<{ id: string }[]>`
        select id from famcal.google_accounts where not exists (select 1 from famcal.google_accounts where is_family)
        order by sort, created_at limit 1`;
      if (first) await sql`update famcal.google_accounts set is_family = true where id = ${first.id}`;
      return NextResponse.json({ accounts: await listAccounts() });
    }

    case "invite": {
      const email = String(body.email ?? "")
        .trim()
        .toLowerCase();
      if (!EMAIL.test(email)) return bad("Enter an email address.");
      const origin = request.nextUrl.origin;
      const admin = createAdminClient();
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${origin}/auth/confirm?next=/auth/reset`,
      });
      let userId = data?.user?.id;
      if (error) {
        // Already has an account on the shared project (another app): add them; they sign in with
        // that password or use "Forgot password?".
        const [existing] = await sql<
          { id: string }[]
        >`select id from auth.users where lower(email) = ${email}`;
        if (!existing) return bad(error.message);
        userId = existing.id;
      }
      await sql`insert into famcal.members (user_id, email, added_by) values (${userId!}, ${email}, ${member.userId})
        on conflict (user_id) do nothing`;
      return NextResponse.json({ invited: !error, email });
    }

    case "removeMember": {
      // Their Supabase account stays (other apps may use it); every famcal request checks
      // membership, so they lose access at once (FR-9).
      if (body.userId === member.userId) return bad("You can't remove yourself.");
      await sql`delete from famcal.members where user_id = ${body.userId}`;
      return NextResponse.json({ ok: true });
    }

    default:
      return bad("bad_action");
  }
}
