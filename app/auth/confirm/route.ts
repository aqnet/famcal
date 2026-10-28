import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth";
import { appOrigin } from "@/lib/origin";

// Landing route for email links (password reset, invites). Handles all three shapes Supabase
// can send: token_hash (custom templates), ?code= (PKCE), or tokens in the URL fragment.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const origin = appOrigin(request.nextUrl.origin);
  const next = safeNext(searchParams.get("next"), "/auth/reset");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, origin));
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  } else if (!searchParams.get("error")) {
    // Implicit-flow links (admin invites) put the tokens in the #fragment, which only the browser
    // can read. Browsers keep the fragment across this redirect.
    return NextResponse.redirect(new URL(`/auth/hash?next=${encodeURIComponent(next)}`, origin));
  }

  const login = new URL("/login", origin);
  login.searchParams.set("error", "link");
  return NextResponse.redirect(login);
}
