import { NextResponse } from "next/server";
import { requireMemberApi } from "@/lib/auth";
import { getWeather } from "@/lib/weather";

export const dynamic = "force-dynamic";

export async function GET() {
  const member = await requireMemberApi();
  if (member instanceof NextResponse) return member;
  return NextResponse.json({ weather: await getWeather() });
}
