import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

function key(): Buffer {
  const raw = process.env.FAMCAL_ENCRYPTION_KEY;
  if (!raw) throw new Error("Missing environment variable FAMCAL_ENCRYPTION_KEY (see .env.example)");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("FAMCAL_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return buf;
}

// AES-256-GCM; output is "v1.<iv>.<tag>.<ciphertext>" in base64url.
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function decrypt(sealed: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || data === undefined) throw new Error("Unrecognised ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  return `scrypt.${salt.toString("base64url")}.${scryptSync(pin, salt, 32).toString("base64url")}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(".");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(pin, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}

// Short-lived signed token, e.g. "PIN unlocked for this user until <time>".
export function sign(payload: string): string {
  return `${payload}.${createHmac("sha256", key()).update(payload).digest("base64url")}`;
}

export function verifySigned(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const expected = Buffer.from(sign(payload).slice(dot + 1));
  const actual = Buffer.from(token.slice(dot + 1));
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? payload : null;
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}
