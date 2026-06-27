import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config. Separate from the Next.js build so test execution does
 * not require a running Next dev server.
 *
 * - node environment: crypto.subtle is available globally on Node 19+.
 * - alias "@/*" → repo root, matching tsconfig.json paths.
 * - include: just the test files we own. UI component tests can be added
 *   later under tests/components/ if we ever want them.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});