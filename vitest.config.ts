import { defineConfig } from "vitest/config";
import path from "node:path";

// Dates in tests are local times; pin the zone so they mean the same everywhere (the display runs in
// the household's zone, which is Pacific).
process.env.TZ = "America/Los_Angeles";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      "server-only": path.resolve(__dirname, "test/server-only.ts"),
    },
  },
  test: {
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    coverage: {
      provider: "v8",
      // Logic only: React components and pages are covered by browser tests, not here.
      include: ["lib/**/*.ts", "app/**/route.ts", "app/**/actions.ts", "components/display/*.ts", "proxy.ts"],
      exclude: ["**/*.test.ts", "components/display/types.ts", "components/display/hooks.ts"],
      reporter: ["text-summary", "text"],
    },
  },
});
