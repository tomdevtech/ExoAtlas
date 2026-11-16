/**
 * Draws many planets of the catalogue onto one sheet, side by side.
 *
 *   npm run planets:sheet
 *   npm run planets:sheet -- 80 sheet.png
 *   BASE_URL=http://localhost:3001 npm run planets:sheet
 *
 * Whether the planets look real, and whether they differ enough from each
 * other, only shows when many of them stand next to each other. Run this
 * after a change to the look (appearance.ts, the shaders, the presets) and
 * compare the sheet with the one from before.
 *
 * It asks the database for a spread of planets, the same ones every time,
 * opens the page of each in a headless Chromium against a running ExoFinder
 * (by default the dev server on http://localhost:3000) and photographs its 3D
 * model. The first run needs the browser: `npx playwright install chromium --only-shell`.
 */
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { chromium } from "playwright";
import sharp, { type OverlayOptions } from "sharp";
import { describePlanet } from "@/app/planets/labels";
import { closeDb, getDb } from "@/db/client";
import { planets } from "@/db/schema";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const COUNT = Number(process.argv[2] ?? 48);
const OUT = process.argv[3] ?? join(process.cwd(), "planet-sheet.png");
/** Width and height of one planet on the sheet, and the room for its name below. */
const TILE = 260;
const CAPTION = 44;
const COLUMNS = 8;

const escape = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

async function main() {
  // Ordered by a hash of the name: a spread over the whole catalogue that
  // stays the same from run to run.
  const chosen = await getDb()
    .select({
      slug: planets.slug,
      name: planets.name,
      planetClass: planets.planetClass,
      climateClass: planets.climateClass,
    })
    .from(planets)
    .where(and(eq(planets.status, "active"), eq(planets.source, "nasa")))
    .orderBy(sql`md5(${planets.slug})`)
    .limit(COUNT);
  await closeDb();
  if (chosen.length === 0) throw new Error("The catalogue is empty. Run `npm run sync` first.");

  const browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const tiles: OverlayOptions[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
    console.log(`${chosen.length} planets of ${BASE_URL} onto ${OUT}`);
    for (const [index, planet] of chosen.entries()) {
      await page.goto(`${BASE_URL}/planets/${planet.slug}`);
      // The buttons of the 3D model appear once it is drawn.
      await page.getByRole("button", { name: "Reset" }).waitFor({ state: "visible", timeout: 60_000 });
      await page.waitForTimeout(600);
      const picture = await page.getByRole("group", { name: /^3D model of/ }).locator("canvas").screenshot();
      const left = (index % COLUMNS) * TILE;
      const top = Math.floor(index / COLUMNS) * (TILE + CAPTION);
      tiles.push({
        input: await sharp(picture).resize(TILE, TILE, { fit: "contain", background: "#05060a" }).toBuffer(),
        left,
        top,
      });
      const caption = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${CAPTION}">
        <text x="${TILE / 2}" y="16" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#e8eaf0">${escape(planet.name)}</text>
        <text x="${TILE / 2}" y="33" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#8a90a0">${escape(describePlanet(planet.planetClass, planet.climateClass))}</text>
      </svg>`;
      tiles.push({ input: Buffer.from(caption), left, top: top + TILE });
      console.log(`  ${planet.name}`);
    }
  } finally {
    await browser.close();
  }

  const rows = Math.ceil(chosen.length / COLUMNS);
  await sharp({
    create: {
      width: Math.min(chosen.length, COLUMNS) * TILE,
      height: rows * (TILE + CAPTION),
      channels: 3,
      background: "#05060a",
    },
  })
    .composite(tiles)
    .png()
    .toFile(OUT);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
