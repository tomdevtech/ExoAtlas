import sharp from "sharp";
import { expect, test } from "@tests/e2e/fixtures";

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

  test("shows the whole galaxy from outside, on a black sky", async ({ page }) => {
    // The picture of the galaxy is only fetched once the camera leaves the Sun.
    const picture = page.waitForResponse((response) => /\/textures\/sky\/galaxy-(sm|lg)\.jpg$/.test(response.url()));
    await page.goto("/map?view=galaxy");
    await waitForMap(page);
    expect((await picture).status()).toBe(200);
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
