import AxeBuilder from "@axe-core/playwright";
import { expect, test, typeUntil } from "./fixtures";

/**
 * Automatic accessibility checks with axe-core against WCAG 2.1 A and AA.
 * They find missing labels, poor contrast, broken ARIA and similar problems.
 * They do not replace a test with a screen reader and the keyboard.
 */
const PAGES: { path: string; ready: string }[] = [
  { path: "/", ready: "Places to start" },
  { path: "/planets", ready: "All planets" },
  { path: "/planets?q=trappist&sort=discovery", ready: "All planets" },
  { path: "/planets/trappist-1-e", ready: "TRAPPIST-1 e" },
  { path: "/planets/earth", ready: "Earth" },
  { path: "/stars/trappist-1", ready: "TRAPPIST-1" },
  { path: "/stars/sun", ready: "Sun" },
  { path: "/search?q=kepler", ready: "Search" },
  { path: "/legal/notice", ready: "Legal notice" },
  { path: "/legal/privacy", ready: "Privacy policy" },
];

test.describe("accessibility", () => {
  for (const { path, ready } of PAGES) {
    test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: ready }).first()).toBeVisible();
      // Wait for the streamed parts; their placeholders say aria-busy.
      await expect(page.locator("[aria-busy=true]")).toHaveCount(0);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const summary = results.violations.map(
        (v) => `${v.id} (${v.impact}): ${v.help} – ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
      );
      expect(summary).toEqual([]);
    });
  }

  test("the search suggestions are accessible while open", async ({ page }) => {
    await page.goto("/");
    const hero = page.locator("[data-hero-search]");
    await typeUntil(hero.getByRole("combobox"), "trappist", hero.getByRole("listbox", { name: "Suggestions" }));
    const results = await new AxeBuilder({ page })
      .include("[data-hero-search]")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  test("the page can be used with the keyboard alone", async ({ page }) => {
    await page.goto("/planets");
    // The first Tab lands on the logo link in the header.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("banner").getByRole("link", { name: "ExoAtlas" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("banner").getByRole("combobox")).toBeFocused();
  });
});
