import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { expect, test } from "@tests/e2e/fixtures";
import { e2eDatabaseUrl } from "@tests/support/db";

const run = promisify(execFile);

test.describe("scripts that need the running app", () => {
  test("planet-sheet draws a spread of planets onto one picture", async ({ baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const sheet = testInfo.outputPath("sheet.png");
    // This runs what `npm run planets:sheet -- 3 sheet.png` runs, against the app and database of the tests.
    const { stdout } = await run(
      process.execPath,
      ["--import", "tsx", "scripts/planet-sheet.ts", "3", sheet],
      { env: { ...process.env, BASE_URL: baseURL, DATABASE_URL: e2eDatabaseUrl() } },
    );
    expect(stdout).toContain("3 planets");

    // The sheet shows three planets side by side, each with its name below.
    const { data, info } = await sharp(sheet).greyscale().raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(3 * 260);
    expect(info.height).toBe(260 + 44);
    // Each tile must show a lit planet and not a black square.
    for (let tile = 0; tile < 3; tile++) {
      let brightest = 0;
      for (let y = 30; y < 230; y++) {
        for (let x = tile * 260 + 30; x < tile * 260 + 230; x++) brightest = Math.max(brightest, data[y * info.width + x]);
      }
      expect(brightest, `planet ${tile + 1}`).toBeGreaterThan(80);
    }
  });
});
