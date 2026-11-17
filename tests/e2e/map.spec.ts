import sharp from "sharp";
import { expect, test } from "@tests/e2e/fixtures";
import { difference, expectLook, type Picture } from "@tests/e2e/lab";

/** Waits until the map has loaded its stars. */
async function waitForMap(page: import("@playwright/test").Page) {
  await expect(page.getByRole("heading", { name: "The map needs WebGL 2" })).toHaveCount(0);
  await expect(page.getByText("Loading the stars…")).toBeHidden({ timeout: 45_000 });
}

test.describe("map", () => {
  test("loads the stars and finds one by name", async ({ page }) => {
    await page.goto("/map");
    await waitForMap(page);

    const finder = page.getByRole("searchbox", { name: "Find a star on the map" });
    await finder.fill("trapp");
    await page.getByRole("button", { name: /TRAPPIST-1/ }).click();

    const panel = page.getByRole("heading", { level: 2, name: "TRAPPIST-1" });
    await expect(panel).toBeVisible();
    await expect(page.getByRole("button", { name: "Enter system" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Star page" })).toHaveAttribute("href", "/stars/trappist-1");
  });

  test("says so when no star has the name", async ({ page }) => {
    await page.goto("/map");
    await waitForMap(page);
    await page.getByRole("searchbox", { name: "Find a star on the map" }).fill("zzqq");
    await expect(page.getByText("No star with this name.")).toBeVisible();
  });

  test("leaves out stars without a known distance", async ({ page }) => {
    await page.goto("/map");
    await waitForMap(page);
    await page.getByRole("searchbox", { name: "Find a star on the map" }).fill("nodist");
    await expect(page.getByText("No star with this name.")).toBeVisible();
  });

  test("opens a system from the address and goes back to the galaxy", async ({ page }) => {
    await page.goto("/map?system=trappist-1");
    await waitForMap(page);
    const back = page.getByRole("button", { name: "← Galaxy" });
    await expect(back).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 2, name: "TRAPPIST-1" })).toBeVisible();
    await back.click();
    await expect(back).toBeHidden();
  });

  test("opens the planet's system when the map was already open before", async ({ page }) => {
    // Next keeps the map loaded (and hidden) after it was left. When its effects
    // read the address themselves, they can run before Next has written the new
    // one: under `next dev` that left the visitor in the galaxy instead of the
    // system the link named. The production build here did not show it, so this
    // test guards the path, not that exact timing.
    await page.goto("/map");
    await waitForMap(page);
    await page.getByRole("searchbox", { name: "Find a star on the map" }).fill("trapp");
    await page.getByRole("button", { name: /TRAPPIST-1/ }).click();
    await page.getByRole("link", { name: "Star page" }).click();
    await page.getByRole("link", { name: /^TRAPPIST-1 e\b/ }).click();
    await page.getByRole("link", { name: "See it on its orbit in 3D" }).click();

    await expect(page).toHaveURL(/\/map\?system=trappist-1&planet=trappist-1-e$/);
    await expect(page.getByRole("button", { name: "← Galaxy" })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 2, name: "TRAPPIST-1" })).toBeVisible();
    // The address stays on the system once it has loaded.
    await expect(page).toHaveURL(/\/map\?system=trappist-1&planet=trappist-1-e$/);
  });

  test("shows the whole galaxy from outside, on a black sky", async ({ page }) => {
    // The galaxy is built after the artist's impression: the picture is fetched,
    // and a worker places the clouds beside the map.
    const picture = page.waitForResponse((response) => response.url().endsWith("/textures/sky/galaxy.jpg"));
    const worker = page.waitForEvent("worker");
    // The worker is ended once it has handed over the clouds.
    let cloudsMade = false;
    page.on("worker", (started) => started.on("close", () => (cloudsMade = true)));
    await page.goto("/map?view=galaxy");
    await waitForMap(page);
    expect((await picture).status()).toBe(200);
    expect((await worker).url()).toContain("/_next/");
    // From out there the camera circles the centre of the galaxy.
    await expect(page.getByRole("button", { name: "Fly freely" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("link", { name: "NASA/JPL-Caltech/ESO/R. Hurt" })).toBeVisible();
    await expect(page.getByText("the galaxy is an artist’s impression")).toBeVisible();

    // How bright the map is around a point, given as shares of its width and height.
    const canvas = page.locator("canvas").first();
    const brightness = async (x: number, y: number) => {
      const { data, info } = await sharp(await canvas.screenshot()).greyscale().raw().toBuffer({ resolveWithObject: true });
      const left = Math.round(info.width * x);
      const top = Math.round(info.height * y);
      let sum = 0;
      for (let dy = 0; dy < 12; dy++) {
        for (let dx = 0; dx < 12; dx++) sum += data[(top + dy) * info.width + left + dx];
      }
      return sum / 144;
    };
    // The flight out takes a few seconds, then the galaxy fills the middle of the picture.
    await expect.poll(() => brightness(0.5, 0.6), { timeout: 30_000 }).toBeGreaterThan(60);
    // Beside it there is no sky from the Sun's point of view any more, only black.
    expect(await brightness(0.02, 0.5)).toBeLessThan(6);

    // As the visitor sees it: the glow, the clouds and clusters of the worker,
    // and the stars. Once the clouds are there and the camera rests, the
    // picture stands still.
    await expect.poll(() => cloudsMade, { timeout: 45_000 }).toBe(true);
    const shot = async (): Promise<Picture> => {
      const { data, info } = await sharp(await canvas.screenshot()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { width: info.width, height: info.height, data: new Uint8Array(data) };
    };
    let last = await shot();
    await expect
      .poll(
        async () => {
          await page.waitForTimeout(700);
          const now = await shot();
          const change = difference(last, now);
          last = now;
          return change;
        },
        { timeout: 30_000 },
      )
      .toBeLessThan(0.05);
    await expectLook(last, "map-galaxy-from-outside");
  });

  test("names famous sights near the Sun", async ({ page }) => {
    await page.goto("/map");
    await waitForMap(page);
    // The Veil Nebula, the shell of a star that exploded 735 parsecs away, is in view from home.
    await expect(page.getByText("Veil Nebula", { exact: true })).toBeVisible();
  });

  test("circles the centre of the galaxy on request, and flies freely again", async ({ page }) => {
    await page.goto("/map");
    await waitForMap(page);
    const canvas = page.locator("canvas").first();
    const circle = page.getByRole("button", { name: "Orbit centre" });
    await expect(circle).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText(/Drag to look around · W A S D to fly/)).toBeVisible();

    await circle.click();
    const free = page.getByRole("button", { name: "Fly freely" });
    await expect(free).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/Drag to turn round the centre · scroll or W and S to zoom/)).toBeVisible();
    // Dragging turns the view round the centre and does not end the circling.
    const box = await canvas.boundingBox();
    if (!box) throw new Error("The map has no canvas.");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 30, { steps: 6 });
    await page.mouse.up();
    await expect(free).toHaveAttribute("aria-pressed", "true");

    // Flying home ends it, and so does the button.
    await page.getByRole("button", { name: "Sun", exact: true }).click();
    await expect(circle).toHaveAttribute("aria-pressed", "false");
    await circle.click();
    await free.click();
    await expect(circle).toHaveAttribute("aria-pressed", "false");
  });

  test("draws the planets from their small maps and loads the large map of the one it follows", async ({ page }) => {
    const maps: string[] = [];
    page.on("request", (request) => {
      const map = /\/textures\/presets\/[a-z-]+-(sm|lg)\.webp$/.exec(request.url());
      if (map) maps.push(map[1]);
    });
    await page.goto("/map?system=trappist-1");
    await waitForMap(page);
    await expect(page.getByRole("button", { name: "← Galaxy" })).toBeVisible({ timeout: 45_000 });
    await expect.poll(() => maps.includes("sm")).toBe(true);
    expect(maps).not.toContain("lg");

    await page.getByRole("button", { name: /^TRAPPIST-1 e/ }).click();
    await expect(page).toHaveURL(/planet=trappist-1-e/);
    // A rocky planet is mixed from two base maps.
    await expect.poll(() => maps.filter((size) => size === "lg")).toHaveLength(2);
  });
});
