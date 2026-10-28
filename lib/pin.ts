import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPin, sign, verifyPin, verifySigned } from "@/lib/crypto";
import { nextLockout } from "@/lib/pin-lockout";

const COOKIE = "famcal_pin";
const UNLOCK_SECONDS = 10 * 60;

// The PIN unlocks Settings for 10 minutes on this device, for this signed-in user.
export async function pinUnlocked(userId: string): Promise<boolean> {
  const token = (await cookies()).get(COOKIE)?.value;
  const payload = token ? verifySigned(token) : null;
  if (!payload) return false;
  const [uid, until] = payload.split(":");
  return uid === userId && Number(until) > Date.now();
}

export async function requirePinApi(userId: string): Promise<NextResponse | null> {
  return (await pinUnlocked(userId)) ? null : NextResponse.json({ error: "pin_required" }, { status: 403 });
}

async function grantUnlock(userId: string) {
  (await cookies()).set(COOKIE, sign(`${userId}:${Date.now() + UNLOCK_SECONDS * 1000}`), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: UNLOCK_SECONDS,
  });
}

export async function lockPin() {
  (await cookies()).delete(COOKIE);
}

// First Google account connects without a PIN (setup); later ones are a Settings action.
export async function hasPinOrNone(userId: string): Promise<boolean> {
  const [{ count }] = await db()<
    { count: number }[]
  >`select count(*)::int as count from famcal.google_accounts`;
  return count === 0 || (await pinUnlocked(userId));
}

export type PinResult =
  | { ok: true }
  | { ok: false; reason: "wrong"; attemptsLeft: number }
  | { ok: false; reason: "locked"; retryAt: string }
  | { ok: false; reason: "unset" };

// Check a PIN with server-side attempt counting (FR-6): 5 wrong entries lock entry for 5 minutes,
// and each further run of failures doubles the lockout.
export async function checkPin(userId: string, pin: string): Promise<PinResult> {
  return db().begin(async (sql) => {
    const [row] = await sql<
      {
        pin_hash: string | null;
        pin_failed: number;
        pin_locked_until: Date | null;
        pin_lockout_seconds: number;
      }[]
    >`select pin_hash, pin_failed, pin_locked_until, pin_lockout_seconds from famcal.household where id = 1 for update`;
    if (!row.pin_hash) return { ok: false, reason: "unset" } as const;
    if (row.pin_locked_until && row.pin_locked_until.getTime() > Date.now()) {
      return { ok: false, reason: "locked", retryAt: row.pin_locked_until.toISOString() } as const;
    }
    if (verifyPin(pin, row.pin_hash)) {
      await sql`update famcal.household set pin_failed = 0, pin_locked_until = null, pin_lockout_seconds = 300 where id = 1`;
      await grantUnlock(userId);
      return { ok: true } as const;
    }
    const next = nextLockout(row.pin_failed + 1, row.pin_lockout_seconds);
    const lockedUntil = next.lockSeconds ? new Date(Date.now() + next.lockSeconds * 1000) : null;
    await sql`update famcal.household set pin_failed = ${next.failed}, pin_locked_until = ${lockedUntil},
      pin_lockout_seconds = ${next.lockoutSeconds} where id = 1`;
    return lockedUntil
      ? ({ ok: false, reason: "locked", retryAt: lockedUntil.toISOString() } as const)
      : ({ ok: false, reason: "wrong", attemptsLeft: 5 - next.failed } as const);
  });
}

// Setting the PIN the first time needs no PIN; changing it needs the current unlock.
export async function setPin(userId: string, pin: string): Promise<boolean> {
  const [row] = await db()<{ pin_hash: string | null }[]>`select pin_hash from famcal.household where id = 1`;
  if (row.pin_hash && !(await pinUnlocked(userId))) return false;
  await db()`update famcal.household set pin_hash = ${hashPin(pin)}, pin_failed = 0, pin_locked_until = null,
    pin_lockout_seconds = 300, updated_at = now() where id = 1`;
  await grantUnlock(userId);
  return true;
}
