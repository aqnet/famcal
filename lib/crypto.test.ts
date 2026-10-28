import { beforeAll, describe, expect, it } from "vitest";
import { decrypt, encrypt, hashPin, sign, verifyPin, verifySigned } from "./crypto";

beforeAll(() => {
  process.env.FAMCAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("crypto", () => {
  it("round-trips encrypted text and rejects tampering", () => {
    const sealed = encrypt("1//refresh-token");
    expect(sealed).not.toContain("refresh");
    expect(decrypt(sealed)).toBe("1//refresh-token");
    const parts = sealed.split(".");
    parts[3] = Buffer.from("other").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });

  it("hashes and verifies a PIN", () => {
    const stored = hashPin("4821");
    expect(verifyPin("4821", stored)).toBe(true);
    expect(verifyPin("4820", stored)).toBe(false);
  });

  it("signs and verifies payloads", () => {
    const token = sign("user.123");
    expect(verifySigned(token)).toBe("user.123");
    expect(verifySigned(token.replace("user.123", "user.124"))).toBeNull();
  });
});
