import "server-only";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";

export type Member = { userId: string; email: string };

export async function getUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function isMember(userId: string): Promise<boolean> {
  const rows = await db()`select 1 from famcal.members where user_id = ${userId}`;
  return rows.length > 0;
}

// For pages: signed in and on the famcal allowlist, or redirect.
export async function requireMemberPage(): Promise<Member> {
  const user = await getUser();
  if (!user) redirect("/login");
  if (!(await isMember(user.id))) redirect("/auth/no-access");
  return { userId: user.id, email: user.email ?? "" };
}

// For API routes: 401 without a session, 403 for non-members (FR-8).
export async function requireMemberApi(): Promise<Member | NextResponse> {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!(await isMember(user.id))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return { userId: user.id, email: user.email ?? "" };
}

// Allow only same-origin relative paths for post-login redirects.
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
