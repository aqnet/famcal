import { afterEach, describe, expect, it, vi } from "vitest";
import { appOrigin } from "./origin";

describe("appOrigin", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses APP_ORIGIN when set, without a trailing slash", () => {
    vi.stubEnv("APP_ORIGIN", "https://calendar.example.com/");
    expect(appOrigin("http://0.0.0.0:8080")).toBe("https://calendar.example.com");
  });

  it("falls back to the request origin in development", () => {
    vi.stubEnv("APP_ORIGIN", "");
    expect(appOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });
});
