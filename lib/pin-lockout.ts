export const MAX_ATTEMPTS = 5;

// After a wrong PIN: how many failures are now counted, whether to lock (and for how long),
// and what the next lockout will be. The lockout doubles after each run of 5 failures and is
// reset to 5 minutes by a correct PIN.
export function nextLockout(
  failed: number,
  lockoutSeconds: number,
): { failed: number; lockSeconds: number | null; lockoutSeconds: number } {
  if (failed < MAX_ATTEMPTS) return { failed, lockSeconds: null, lockoutSeconds };
  return { failed: 0, lockSeconds: lockoutSeconds, lockoutSeconds: lockoutSeconds * 2 };
}
