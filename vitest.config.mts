import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The same "@/…" alias as in tsconfig.json.
const resolve = { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } };

export default defineConfig({
  test: {
    projects: [
      {
        // Tests sit next to the code they test. They need neither a database
        // nor a browser: `npm test`.
        resolve,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.db.test.ts"],
        },
      },
      {
        // Tests against a real PostgreSQL with the small test catalogue from
        // src/test/catalog.ts: `npm run test:db`. See src/test/db.ts.
        resolve,
        test: {
          name: "db",
          include: ["src/**/*.db.test.ts"],
          globalSetup: ["src/test/db-global-setup.ts"],
          setupFiles: ["src/test/db-setup.ts"],
          // All files share one database, and the sync test changes it.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
