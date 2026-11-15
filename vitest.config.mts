import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The same aliases as in tsconfig.json: "@/…" is the app in src/, "@tests/…" the tests.
const resolve = {
  alias: {
    "@tests": fileURLToPath(new URL("./tests", import.meta.url)),
    "@": fileURLToPath(new URL("./src", import.meta.url)),
  },
};

export default defineConfig({
  test: {
    projects: [
      {
        // tests/unit mirrors src/. These tests need neither a database nor a
        // browser: `npm test`.
        resolve,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        // Tests against a real PostgreSQL with the small test catalogue from
        // tests/support/catalog.ts: `npm run test:db`. See tests/support/db.ts.
        resolve,
        test: {
          name: "db",
          include: ["tests/db/**/*.db.test.ts"],
          globalSetup: ["tests/support/db-global-setup.ts"],
          setupFiles: ["tests/support/db-setup.ts"],
          // All files share one database, and the sync test changes it.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
