import { NextResponse } from "next/server";
import { requireMemberApi } from "@/lib/auth";
import { getHousehold } from "@/lib/household";
import { recentGuests } from "@/lib/events";
import { pinUnlocked } from "@/lib/pin";

export const dynamic = "force-dynamic";

// The non-secret settings the display needs (no PIN).
export async function GET() {
  const member = await requireMemberApi();
  if (member instanceof NextResponse) return member;
  const [h, recent, unlocked] = await Promise.all([
    getHousehold(),
    recentGuests(),
    pinUnlocked(member.userId),
  ]);
  return NextResponse.json({
    units: h.units,
    outdoorKeywords: h.outdoorKeywords,
    rotationSeconds: h.rotationSeconds,
    nightStart: h.nightStart,
    nightEnd: h.nightEnd,
    familyMembers: h.familyMembers,
    photoSourceName: h.photoSources.map((s) => s.name).join(", "),
    hasWeather: h.weatherLat !== null,
    hasPin: h.hasPin,
    pinUnlocked: unlocked,
    recentGuests: recent.slice(0, 30),
    // The server's build; an open display reloads when it no longer matches its own.
    build: process.env.NEXT_PUBLIC_BUILD_ID,
  });
}
