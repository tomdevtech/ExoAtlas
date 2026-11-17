import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// These aliases must match the paths in tsconfig.json.
const resolve = {
  alias: {
    "@tests": fileURLToPath(new URL("./tests", import.meta.url)),
    "@": fileURLToPath(new URL("./src", import.meta.url)),
  },
};

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      reporter: ["text-summary", "html"],
      reportsDirectory: "coverage",
    },
    projects: [
      {
        // Unit tests need neither a database nor a browser (`npm test`).
        resolve,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        // These tests run against a real PostgreSQL (`npm run test:db`).
        resolve,
        test: {
          name: "db",
          include: ["tests/db/**/*.db.test.ts"],
          globalSetup: ["tests/support/db-global-setup.ts"],
          setupFiles: ["tests/support/db-setup.ts"],
          // Files run one after another because they share one database that the sync test modifies.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        // These tests run whole scripts from scripts/, hence the long timeouts (`npm run test:scripts`).
        resolve,
        test: {
          name: "scripts",
          include: ["tests/scripts/**/*.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
});
