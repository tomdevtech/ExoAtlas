import { expect, test } from "@tests/e2e/fixtures";

/** Answers of every kind: pages, JSON, a static file and an unknown address. */
const PATHS = ["/", "/planets", "/planets/earth", "/search/suggest?q=ke", "/map/stars", "/health", "/icon.svg", "/does-not-exist"];

test.describe("security headers", () => {
  for (const path of PATHS) {
    test(`${path} carries the protective headers`, async ({ request }) => {
      const response = await request.get(path);
      const headers = response.headers();

      const csp = headers["content-security-policy"] ?? "";
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).not.toContain("unsafe-eval");

      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(headers["permissions-policy"]).toContain("camera=()");
      expect(headers["strict-transport-security"]).toContain("max-age=");
      expect(headers["x-powered-by"]).toBeUndefined();
    });
  }
});

test.describe("hostile input over HTTP", () => {
  const queries = [
    "' OR 1=1 --",
    "'; DROP TABLE planets; --",
    "<script>alert(1)</script>",
    "%00",
    "../../../../etc/passwd",
    "a".repeat(4_000),
  ];

  for (const q of queries) {
    test(`/search/suggest answers JSON for ${JSON.stringify(q.slice(0, 30))}`, async ({ request }) => {
      const response = await request.get("/search/suggest", { params: { q } });
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toMatch(/^application\/json/);
      const body = await response.json();
      expect(body.suggestions.length).toBeLessThanOrEqual(8);
    });
  }

  test("/search/suggest accepts only GET", async ({ request }) => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"] as const) {
      const response = await request.fetch("/search/suggest?q=kepler", { method });
      expect(response.status(), method).toBe(405);
    }
  });

  for (const slug of ["..%2F..%2Fetc%2Fpasswd", "trappist-1'%20or%20'1'%3D'1", "%00", "x".repeat(2_000)]) {
    test(`/map/systems answers 404 for ${slug.slice(0, 30)}`, async ({ request }) => {
      const response = await request.get(`/map/systems/${slug}`);
      expect(response.status()).toBe(404);
      expect(await response.json()).toEqual({ error: "There is no star with this address." });
    });
  }

  test("a broken address answers 400, not a server error", async ({ request }) => {
    // src/proxy.ts catches broken percent-encoding in addresses with a slug.
    for (const path of ["/planets/%E0%A4%A", "/stars/%", "/map/systems/%ZZ"]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(400);
      expect(await response.text(), path).not.toMatch(/at .+\.(js|ts):\d+:\d+/);
    }
    expect((await request.get("/search?q=%")).status()).toBe(200);
  });

  test("a null byte in a slug is simply not found", async ({ request }) => {
    expect((await request.get("/map/systems/sun%00")).status()).toBe(404);
  });
});

test.describe("no script injection through the address", () => {
  const payloads = [
    "<script>window.__pwned=1</script>",
    "<img src=x onerror=\"window.__pwned=1\">",
    "\"><svg onload=window.__pwned=1>",
    "javascript:window.__pwned=1",
  ];

  for (const payload of payloads) {
    test(`search and filter show ${JSON.stringify(payload.slice(0, 25))} as text`, async ({ page }) => {
      const dialogs: string[] = [];
      page.on("dialog", async (dialog) => {
        dialogs.push(dialog.message());
        await dialog.dismiss();
      });

      await page.goto(`/search?q=${encodeURIComponent(payload)}`);
      await expect(page.getByRole("main")).toContainText(payload);
      expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();

      await page.goto(`/planets?q=${encodeURIComponent(payload)}`);
      await expect(page.getByRole("searchbox", { name: "Filter planets by name" })).toHaveValue(payload);
      expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
      expect(dialogs).toEqual([]);
    });
  }
});

test.describe("content security policy in the browser", () => {
  // The fixture fails a test on every CSP violation. These pages use the most:
  // streaming, client components, WebGL, textures and fetch.
  test("the start page, a planet with its model and the map run without violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Places to start" })).toBeVisible();
    await page.goto("/planets/earth");
    await expect(page.getByRole("button", { name: "Reset" })).toBeVisible({ timeout: 45_000 });
    await page.goto("/map?system=sun&planet=earth");
    await expect(page.getByRole("button", { name: "← Galaxy" })).toBeVisible({ timeout: 45_000 });
  });
});

test.describe("framing", () => {
  // The browser reports the refused frame in the console: that is the point.
  test.use({ allowedErrors: /frame/i });

  test("another site cannot show ExoFinder in a frame", async ({ page, baseURL }) => {
    // A page with a different origin (about:blank) tries to frame the site.
    await page.setContent(`<iframe id="f" src="${baseURL}/"></iframe>`);
    const frame = page.frameLocator("#f");
    await expect(frame.getByRole("heading", { name: "ExoFinder" })).toHaveCount(0, { timeout: 5_000 });
  });
});
