import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrl } from "./src/test/db";

/**
 * Browser tests: `npm run test:e2e`.
 *
 * Playwright builds the app, starts it on port 3100 against its own database
 * (exoatlas_e2e, filled with the small test catalogue by e2e/global-setup.ts)
 * and clicks through it like a visitor. The database from docker-compose.yml
 * must be running. The first run needs the browser: `npm run e2e:install`.
 *
 * With E2E_SKIP_BUILD=1 the last build is started as it is.
 */
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // Each browser renders WebGL in software, which takes a full CPU core.
  workers: CI ? 2 : 4,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  // The software renderer for WebGL makes pages with a 3D model slow.
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    colorScheme: "dark",
    launchOptions: {
      // WebGL in a headless browser: the software renderer draws the 3D models and the map.
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      // A phone: the header wraps and the search gets a row of its own.
      name: "phone",
      use: { ...devices["Pixel 7"] },
      testMatch: /(navigation|search)\.spec\.ts/,
    },
    {
      // The smoke test that runs after each deployment (playwright.smoke.config.ts),
      // here against the local build, so it is known to work before it matters.
      name: "smoke",
      testDir: "smoke",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: process.env.E2E_SKIP_BUILD
      ? `npm run start -- --port ${PORT}`
      : `npm run build && npm run start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !CI,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
    env: { DATABASE_URL: e2eDatabaseUrl() },
  },
});
