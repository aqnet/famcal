import { describe, expect, it } from "vitest";
import { nextLockout } from "./pin-lockout";

describe("nextLockout", () => {
  it("counts the first four failures without locking", () => {
    expect(nextLockout(4, 300)).toEqual({ failed: 4, lockSeconds: null, lockoutSeconds: 300 });
  });

  it("locks for 5 minutes on the fifth, then doubles on each further run", () => {
    const first = nextLockout(5, 300);
    expect(first).toEqual({ failed: 0, lockSeconds: 300, lockoutSeconds: 600 });
    expect(nextLockout(5, first.lockoutSeconds)).toEqual({
      failed: 0,
      lockSeconds: 600,
      lockoutSeconds: 1200,
    });
  });
});
