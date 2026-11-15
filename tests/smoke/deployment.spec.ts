/**
 * Smoke test of a running deployment: does it start, reach its database and
 * serve the main pages? It runs after every Vercel deployment against the
 * deployment's own address (.github/workflows/deploy-check.yml), and in the
 * browser tests against the local build.
 *
 * It only relies on what every filled database has: the solar system. The
 * exoplanets differ between production and the test catalogue.
 */
import { expect, test } from "@tests/e2e/fixtures";

// Vercel adds its toolbar to preview deployments. The Content Security Policy
// blocks it, which the browser reports in the console. That is expected.
test.use({ allowedErrors: /vercel\.live|vercel-insights|_vercel/ });

test("the deployment is healthy and is the expected commit", async ({ request }) => {
  const response = await request.get("/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const report = await response.json();
  expect(report).toMatchObject({ status: "ok", database: "ok" });

  // Makes sure the check talks to the deployment it was started for.
  const expected = process.env.SMOKE_EXPECTED_SHA?.slice(0, 7);
  if (expected && report.commit) expect(report.commit).toBe(expected);
});

for (const path of ["/", "/planets", "/planets/earth", "/stars/sun", "/search?q=earth", "/map", "/legal/notice", "/legal/privacy"]) {
  test(`${path} answers 200 with the security headers`, async ({ request }) => {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers()["x-powered-by"]).toBeUndefined();
  });
}

test("the JSON endpoints answer with data from the database", async ({ request }) => {
  const suggest = await (await request.get("/search/suggest?q=earth")).json();
  expect(suggest.suggestions.map((s: { name: string }) => s.name)).toContain("Earth");

  const stars = await request.get("/map/stars");
  expect(stars.status()).toBe(200);
  const { stars: list } = await stars.json();
  expect(list.length).toBeGreaterThan(0);

  const sun = await request.get("/map/systems/sun");
  expect(sun.status()).toBe(200);
  expect(JSON.stringify(await sun.json())).toContain("Jupiter");

  expect((await request.get("/map/systems/no-such-star")).status()).toBe(404);
});

test("a visitor can go from the start page to a planet", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Places to start" })).toBeVisible();
  await page.getByRole("link", { name: /^Earth/ }).first().click();
  await expect(page).toHaveURL(/\/planets\/earth$/);
  await expect(page.getByRole("heading", { level: 1, name: "Earth" })).toBeVisible();
});

test("the planet list and the search work in the browser", async ({ page }) => {
  await page.goto("/planets?q=jupiter");
  await expect(page.getByRole("main").getByRole("link", { name: /Jupiter/ })).toBeVisible();
  await page.goto("/search?q=saturn");
  await expect(page.getByRole("main").getByRole("link", { name: /Saturn/ }).first()).toBeVisible();
});
