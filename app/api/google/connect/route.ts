import { NextResponse, type NextRequest } from "next/server";
import { requireMemberApi } from "@/lib/auth";
import { authUrl } from "@/lib/google";
import { randomToken } from "@/lib/crypto";
import { hasPinOrNone } from "@/lib/pin";
import { appOrigin } from "@/lib/origin";

// Start Google OAuth for one account (FR-1). The first account needs no PIN (setup);
// adding or reconnecting later is a Settings action and needs the PIN.
export async function GET(request: NextRequest) {
  const member = await requireMemberApi();
  if (member instanceof NextResponse) return member;
  if (!(await hasPinOrNone(member.userId))) {
    return NextResponse.redirect(new URL("/settings", appOrigin(request.nextUrl.origin)));
  }

  const state = randomToken();
  const res = NextResponse.redirect(
    authUrl(appOrigin(request.nextUrl.origin), state, request.nextUrl.searchParams.get("hint") ?? undefined),
  );
  res.cookies.set("famcal_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/google",
    maxAge: 600,
  });
  return res;
}
