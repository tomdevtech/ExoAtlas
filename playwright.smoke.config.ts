import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke test against a deployment that is already running: `npm run test:smoke`.
 *
 *   SMOKE_BASE_URL=https://exoatlas-abc123.vercel.app npm run test:smoke
 *
 * VERCEL_AUTOMATION_BYPASS_SECRET gets it past Vercel's Deployment
 * Protection. SMOKE_EXPECTED_SHA makes it check that the deployment runs this
 * commit. See docs/DEPLOYMENT.md.
 */
const BASE_URL = process.env.SMOKE_BASE_URL?.replace(/\/+$/, "");
if (!BASE_URL) {
  throw new Error("Set SMOKE_BASE_URL to the address of the deployment to check.");
}
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "smoke",
  // A short network hiccup must not roll back a good deployment.
  retries: 2,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 15_000 },
  reporter: CI ? [["github"], ["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: BASE_URL,
    colorScheme: "dark",
    trace: "retain-on-failure",
    extraHTTPHeaders: bypass
      ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" }
      : undefined,
  },
});
