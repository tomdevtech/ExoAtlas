import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import PRESETS from "@/app/planets/globe/presets.json";

/**
 * Runs scripts/generate-presets.ts at a fraction of the real size into its own
 * folder (PRESET_DIR), so the app's maps stay untouched. Whether the maps look
 * right is judged by eye with scripts/preview-presets.ts; these tests cover
 * completeness and determinism.
 */

const run = promisify(execFile);

/** Runs a small `npm run presets`: first the rocky maps, then the banded ones. */
async function generate(folder: string, only?: string): Promise<void> {
  const env = { ...process.env, PRESET_DIR: folder, ...(only ? { PRESET_ONLY: only } : {}) };
  for (const kind of ["terrain", "bands"]) {
    await run(process.execPath, ["--import", "tsx", "scripts/generate-presets.ts", kind, "128"], { env });
  }
}

let first = "";
let second = "";

/**
 * Opens a map of the first run. It is read into memory first, because sharp
 * would otherwise keep the file locked on Windows and the cleanup would fail.
 */
const picture = async (file: string) => sharp(await readFile(path.join(first, file)));

beforeAll(async () => {
  first = await mkdtemp(path.join(tmpdir(), "presets-"));
  second = await mkdtemp(path.join(tmpdir(), "presets-"));
  await generate(first);
  // One rocky and one banded preset are generated again to check that the output is deterministic.
  await generate(second, "volcanic,bands-calm");
});

afterAll(async () => {
  await rm(first, { recursive: true, force: true });
  await rm(second, { recursive: true, force: true });
});

describe("generate-presets", () => {
  it("writes every preset the app knows, in both sizes", async () => {
    const files = (await readdir(first)).sort();
    const names = [...Object.keys(PRESETS.terrain), ...Object.keys(PRESETS.bands)];
    const expected = [...names.flatMap((name) => [`${name}-lg.webp`, `${name}-sm.webp`]), "presets.json"].sort();
    expect(files).toEqual(expected);
    // Whatever size is simulated, the files must have the sizes the app loads.
    for (const name of ["continents", "bands-stormy"]) {
      const large = await picture(`${name}-lg.webp`).then((image) => image.metadata());
      const small = await picture(`${name}-sm.webp`).then((image) => image.metadata());
      expect([large.width, large.height]).toEqual([2048, 1024]);
      expect([small.width, small.height]).toEqual([512, 256]);
    }
  });

  it("writes what the app has to know about each preset", async () => {
    const meta = JSON.parse(await readFile(path.join(first, "presets.json"), "utf8")) as typeof PRESETS;
    // The rocky run comes first, and its entries must not be lost when the banded run adds its part.
    expect(Object.keys(meta.terrain)).toEqual(Object.keys(PRESETS.terrain));
    expect(Object.keys(meta.bands)).toEqual(Object.keys(PRESETS.bands));
    for (const [name, { levels }] of Object.entries(meta.terrain)) {
      expect(levels, name).toHaveLength(21);
      expect(levels[0], name).toBe(0);
      expect(levels[20], name).toBe(1);
      for (let i = 1; i < levels.length; i++) expect(levels[i], name).toBeGreaterThanOrEqual(levels[i - 1]);
    }
    // The winds do not depend on the map size, so they must equal those of the real maps.
    expect(meta.bands).toEqual(PRESETS.bands);
  });

  it("gives the same files for the same run", async () => {
    for (const file of ["volcanic-lg.webp", "volcanic-sm.webp", "bands-calm-lg.webp", "bands-calm-sm.webp"]) {
      const a = await readFile(path.join(first, file));
      const b = await readFile(path.join(second, file));
      expect(a.equals(b), file).toBe(true);
    }
  });

  it("leaves presets.json alone on a trial run of some presets", async () => {
    expect(await readdir(second)).not.toContain("presets.json");
  });

  it("puts height, water and craters into the three channels of a rocky map", async () => {
    const stats = await picture("volcanic-lg.webp").then((image) => image.stats());
    const [height, water, craters] = stats.channels;
    // Heights fill the whole range, water runs in few places, and level ground is the neutral middle grey of the crater channel.
    expect(height.max - height.min).toBeGreaterThan(200);
    expect(water.mean).toBeLessThan(60);
    expect(craters.mean).toBeGreaterThan(110);
    expect(craters.mean).toBeLessThan(145);
  });
});
