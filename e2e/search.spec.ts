import { expect, test, typeUntil } from "./fixtures";

/** The large search field on the start page. In the header it is hidden there. */
function heroSearch(page: import("@playwright/test").Page) {
  const box = page.locator("[data-hero-search]");
  return {
    field: box.getByRole("combobox", { name: "Search planets and stars" }),
    list: box.getByRole("listbox", { name: "Suggestions" }),
  };
}

test.describe("search suggestions", () => {
  test("appear while typing and lead to the page that is clicked", async ({ page }) => {
    await page.goto("/");
    const { field, list } = heroSearch(page);
    await typeUntil(field, "trappist", list);

    await expect(list.getByRole("option")).toHaveCount(8);
    await expect(field).toHaveAttribute("aria-expanded", "true");

    await list.getByRole("option", { name: /TRAPPIST-1 e/ }).click();
    await expect(page).toHaveURL(/\/planets\/trappist-1-e$/);
    await expect(page.getByRole("heading", { level: 1, name: "TRAPPIST-1 e" })).toBeVisible();
  });

  test("can be chosen with the keyboard", async ({ page }) => {
    await page.goto("/");
    const { field, list } = heroSearch(page);
    await typeUntil(field, "proxima", list.getByRole("option").first());

    await field.press("ArrowDown");
    await expect(list.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
    await field.press("Enter");
    await expect(page).toHaveURL(/\/(stars\/proxima-cen|planets\/proxima-cen-b)$/);
  });

  test("close with Escape", async ({ page }) => {
    await page.goto("/");
    const { field, list } = heroSearch(page);
    await typeUntil(field, "kepler", list);
    await field.press("Escape");
    await expect(list).toBeHidden();
  });

  test("need at least two characters", async ({ page }) => {
    await page.goto("/");
    const { field, list } = heroSearch(page);
    await field.fill("k");
    // Give the debounce time to fire, then make sure nothing was suggested.
    await page.waitForTimeout(400);
    await expect(list).toBeHidden();
  });
});

test.describe("search results page", () => {
  test("Enter without a chosen suggestion opens the results", async ({ page }) => {
    await page.goto("/");
    const { field } = heroSearch(page);
    await field.fill("kepler-22");
    await field.press("Enter");

    await expect(page).toHaveURL(/\/search\?q=kepler-22$/);
    await expect(page.getByText(/matches for “kepler-22”/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Kepler-22 b/ })).toBeVisible();
  });

  test("the header search works on other pages", async ({ page }) => {
    await page.goto("/planets");
    const field = page.getByRole("banner").getByRole("combobox", { name: "Search planets and stars" });
    await field.fill("55 cnc");
    await field.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=55\+cnc$/);
    await expect(page.getByRole("link", { name: /55 Cnc e/ })).toBeVisible();
  });

  test("offers similar names for typos", async ({ page }) => {
    await page.goto("/search?q=proxma");
    await expect(page.getByText("No name contains “proxma”. These names are similar:")).toBeVisible();
    await expect(page.getByRole("link", { name: /Proxima Cen b/ })).toBeVisible();
  });

  test("says so when nothing matches", async ({ page }) => {
    await page.goto("/search?q=zzqqxxyy");
    await expect(page.getByText(/No planet or star matches “zzqqxxyy”/)).toBeVisible();
  });

  test("explains an empty query", async ({ page }) => {
    await page.goto("/search");
    await expect(page.getByText("Type the name of a planet or a star into the search field.")).toBeVisible();
  });
});
