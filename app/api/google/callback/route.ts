import { NextResponse, type NextRequest } from "next/server";
import { requireMemberApi } from "@/lib/auth";
import { connectFailure, exchangeCode, saveAccount } from "@/lib/google";

export async function GET(request: NextRequest) {
  const member = await requireMemberApi();
  if (member instanceof NextResponse) return member;

  const { searchParams, origin } = request.nextUrl;
  const state = request.cookies.get("famcal_oauth_state")?.value;
  const back = (status: string) => {
    const res = NextResponse.redirect(new URL(`/?google=${status}`, origin));
    res.cookies.delete({ name: "famcal_oauth_state", path: "/api/google" });
    return res;
  };

  if (!state || state !== searchParams.get("state")) return back("state");
  const code = searchParams.get("code");
  if (!code) return back(searchParams.get("error") === "access_denied" ? "denied" : "error");

  try {
    const tokens = await exchangeCode(origin, code);
    await saveAccount(tokens);
    return back("connected");
  } catch (err) {
    console.error("google callback", err);
    return back(connectFailure(err));
  }
}
