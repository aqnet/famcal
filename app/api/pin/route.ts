import { NextResponse, type NextRequest } from "next/server";
import { requireMemberApi } from "@/lib/auth";
import { checkPin, lockPin, pinUnlocked, setPin } from "@/lib/pin";

export const dynamic = "force-dynamic";

export async function GET() {
  const member = await requireMemberApi();
  if (member instanceof NextResponse) return member;
  return NextResponse.json({ unlocked: await pinUnlocked(member.userId) });
}

// { action: "check" | "set" | "lock", pin? }
export async function POST(request: NextRequest) {
  const member = await requireMemberApi();
  if (member instanceof NextResponse) return member;
  const body = (await request.json().catch(() => ({}))) as { action?: string; pin?: string };

  if (body.action === "lock") {
    await lockPin();
    return NextResponse.json({ ok: true });
  }
  if (!body.pin || !/^\d{4}$/.test(body.pin))
    return NextResponse.json({ error: "pin_format" }, { status: 400 });
  if (body.action === "set") {
    return (await setPin(member.userId, body.pin))
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "pin_required" }, { status: 403 });
  }
  return NextResponse.json(await checkPin(member.userId, body.pin));
}
