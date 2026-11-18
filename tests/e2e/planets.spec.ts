import { ACTIVE_EXOPLANETS } from "@tests/support/catalog";
import { expect, test, waitForGlobe } from "@tests/e2e/fixtures";

const ALL_ACTIVE = ACTIVE_EXOPLANETS + 8;

test.describe("list of all planets", () => {
  test("lists every active planet in natural order", async ({ page }) => {
    await page.goto("/planets");
    await expect(page.getByText(`${ALL_ACTIVE} planets`, { exact: true })).toBeVisible();

    const rows = page.getByRole("main").getByRole("listitem");
    await expect(rows).toHaveCount(ALL_ACTIVE);
    const all = await rows.allInnerTexts();
    const index = (name: string) => all.findIndex((text) => text.startsWith(name));
    expect(index("Kepler-12 b")).toBeLessThan(index("Kepler-22 b"));
    expect(index("Kepler-22 b")).toBeLessThan(index("Kepler-129 b"));
    expect(index("Retracted-1 b")).toBe(-1);
  });

  test("filters while typing and keeps the filter in the address", async ({ page }) => {
    await page.goto("/planets");
    await page.getByRole("searchbox", { name: "Filter planets by name" }).pressSequentially("trappist", { delay: 30 });

    await expect(page).toHaveURL(/\/planets\?q=trappist$/);
    await expect(page.getByText("7 planets match “trappist”")).toBeVisible();
    await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(7);

    // The filter lives in the URL, so the filtered list can be reloaded and shared.
    await page.reload();
    await expect(page.getByRole("searchbox", { name: "Filter planets by name" })).toHaveValue("trappist");
    await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(7);
  });

  test("says so when no planet matches", async ({ page }) => {
    await page.goto("/planets?q=zzqqxx");
    await expect(page.getByText(/No planet matches “zzqqxx”/)).toBeVisible();
  });

  test("sorts by discovery year and keeps the filter", async ({ page }) => {
    await page.goto("/planets?q=kepler");
    await page.getByRole("navigation", { name: "Sort order" }).getByRole("link", { name: "Discovery year" }).click();

    await expect(page).toHaveURL(/\/planets\?q=kepler&sort=discovery$/);
    const rows = page.getByRole("main").getByRole("listitem");
    // Kepler-129 b (2016) is the newest of the four matching planets.
    await expect(rows.first()).toContainText("Kepler-129 b");
    await expect(rows.first()).toContainText("2016");
  });

  test("ignores nonsense in the address", async ({ page }) => {
    await page.goto("/planets?page=-5&sort=evil");
    await expect(page.getByText(`${ALL_ACTIVE} planets`, { exact: true })).toBeVisible();
    await page.goto("/planets?page=99999");
    await expect(page.getByRole("main").getByRole("listitem").first()).toBeVisible();
  });
});

test.describe("planet page", () => {
  test("shows the planet, its 3D model and the way to its star", async ({ page }) => {
    await page.goto("/planets/trappist-1-e");
    await expect(page).toHaveTitle("TRAPPIST-1 e · ExoFinder");
    await expect(page.getByRole("heading", { level: 1, name: "TRAPPIST-1 e" })).toBeVisible();
    for (const section of ["Planet", "Orbit", "Discovery"]) {
      await expect(page.getByRole("heading", { name: section, exact: true })).toBeVisible();
    }
    await waitForGlobe(page);

    await page.getByRole("main").getByRole("link", { name: "TRAPPIST-1", exact: true }).first().click();
    await expect(page).toHaveURL(/\/stars\/trappist-1$/);
    await expect(page.getByText("with 7 known planets")).toBeVisible();
  });

  // A lava world, a Neptune-like planet and a gas giant cover each kind of base map.
  for (const slug of ["55-cnc-e", "k2-18-b", "51-peg-b"]) {
    test(`draws the 3D model of ${slug} from its base map`, async ({ page }) => {
      const baseMap = page.waitForResponse((response) =>
        /\/textures\/presets\/[a-z-]+-lg\.webp$/.test(response.url()),
      );
      await page.goto(`/planets/${slug}`);
      expect((await baseMap).status()).toBe(200);
      await waitForGlobe(page);
    });
  }

  // Earth and Mars have lit relief, which uses a shader program of its own.
  for (const slug of ["earth", "mars"]) {
    test(`draws the 3D model of ${slug} from its real map`, async ({ page }) => {
      const realMap = page.waitForResponse((response) => response.url().endsWith(`/textures/planets/${slug}-lg.jpg`));
      await page.goto(`/planets/${slug}`);
      expect((await realMap).status()).toBe(200);
      await waitForGlobe(page);
    });
  }

  test("lets the browser keep the maps of the planets for a day", async ({ request }) => {
    for (const path of [
      "/textures/presets/continents-sm.webp",
      "/textures/planets/earth-lg.jpg",
      "/textures/sky/galaxy.jpg",
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(response.headers()["cache-control"], path).toBe(
        "public, max-age=86400, stale-while-revalidate=604800",
      );
    }
  });

  test("the 3D model reacts to its buttons", async ({ page }) => {
    await page.goto("/planets/jupiter");
    await waitForGlobe(page);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByRole("group", { name: /3D model of Jupiter/ })).toBeVisible();
  });

  test("marks a planet that NASA withdrew", async ({ page }) => {
    await page.goto("/planets/retracted-1-b");
    await expect(page.getByText(/NASA no longer lists this planet/)).toBeVisible();
    await expect(page.getByRole("link", { name: "See it on its orbit in 3D" })).toHaveCount(0);
  });

  test("a planet of the solar system has its own page too", async ({ page }) => {
    await page.goto("/planets/earth");
    await expect(page.getByRole("heading", { level: 1, name: "Earth" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Sun", exact: true }).first()).toBeVisible();
  });
});

test.describe("star page", () => {
  test("lists the planets of the star", async ({ page }) => {
    await page.goto("/stars/trappist-1");
    await expect(page.getByRole("heading", { level: 1, name: "TRAPPIST-1" })).toBeVisible();
    for (const letter of ["b", "e", "h"]) {
      await expect(page.getByRole("link", { name: new RegExp(`TRAPPIST-1 ${letter}`) }).first()).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "View the system in 3D" })).toHaveAttribute(
      "href",
      "/map?system=trappist-1",
    );
  });

  test("the Sun shows the eight planets", async ({ page }) => {
    await page.goto("/stars/sun");
    await expect(page.getByText("Our own star with 8 known planets")).toBeVisible();
  });

  test("the Sun lists its dwarf planets apart from the planets", async ({ page }) => {
    await page.goto("/stars/sun");
    await expect(page.getByRole("heading", { name: "Dwarf planets" })).toBeVisible();
    await page.getByRole("link", { name: /^Ceres/ }).click();
    await expect(page).toHaveURL(/\/solar-system\/ceres$/);
    await expect(page.getByRole("heading", { level: 1, name: "Ceres" })).toBeVisible();
  });
});

test.describe("moon and dwarf planet pages", () => {
  test("show the moon, its real map and the way to its planet", async ({ page }) => {
    const realMap = page.waitForResponse((response) => response.url().endsWith("/textures/planets/europa-lg.jpg"));
    await page.goto("/solar-system/europa");
    await expect(page).toHaveTitle("Europa · ExoFinder");
    await expect(page.getByRole("heading", { level: 1, name: "Europa" })).toBeVisible();
    for (const section of ["Moon", "Orbit", "Discovery", "Other large moons of Jupiter"]) {
      await expect(page.getByRole("heading", { name: section, exact: true })).toBeVisible();
    }
    expect((await realMap).status()).toBe(200);
    await waitForGlobe(page);
    await expect(page.getByText("Galileo Galilei")).toBeVisible();
    await expect(page.getByRole("link", { name: "See it on its orbit in 3D" })).toHaveAttribute(
      "href",
      "/map?system=sun&planet=jupiter&moon=europa",
    );
    await page.getByRole("main").getByRole("link", { name: "Jupiter", exact: true }).click();
    await expect(page).toHaveURL(/\/planets\/jupiter$/);
  });

  test("a planet lists its large moons", async ({ page }) => {
    await page.goto("/planets/saturn");
    await expect(page.getByRole("heading", { name: "Large moons" })).toBeVisible();
    for (const name of ["Mimas", "Titan", "Iapetus"]) {
      await expect(page.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
    }
    await page.getByRole("link", { name: /^Titan/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Titan" })).toBeVisible();
  });

  test("a dwarf planet shows its moon, and the Moon its ancient discovery", async ({ page }) => {
    await page.goto("/solar-system/pluto");
    await expect(page.getByText("Dwarf planet orbiting the")).toBeVisible();
    await expect(page.getByRole("link", { name: /^Charon/ })).toBeVisible();
    await page.goto("/solar-system/moon");
    await expect(page.getByText(/Known since antiquity/)).toBeVisible();
  });
});
