import { expect, test } from "./fixtures";

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
});
