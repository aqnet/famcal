import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { appOrigin } from "@/lib/origin";

const PUBLIC_PREFIXES = ["/login", "/auth/"];
// Served without a session: the browser and iOS fetch these before (or without) signing in.
const PUBLIC_FILES = [
  "/manifest.webmanifest",
  "/sw.js",
  "/favicon.ico",
  "/icon.svg",
  "/apple-icon.png",
  "/famcal-mark.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/famcal-logo.svg",
  "/famcal-logo-dark.svg",
];

// Public pages: the privacy policy and terms, which Google's OAuth review and anyone else must reach.
const PUBLIC_PAGES = ["/privacy", "/terms"];

export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_FILES.includes(pathname) ||
    PUBLIC_PAGES.includes(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
  );
}

// Refresh the Supabase session cookie on every request and gate everything but the login and
// email-link routes (FR-8). Membership in famcal.members is checked on the server after this.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // getUser() validates the session with the auth server (never trust getSession() here).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  if (!user && !isPublicPath(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const url = new URL("/login", appOrigin(request.nextUrl.origin));
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }

  return response;
}
