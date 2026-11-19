/**
 * Downloads the shape models of the irregular bodies and writes their radius grids (scripts/shapes.ts)
 * to public/shapes/<slug>.bin, and the scale of each grid to src/app/solar-system/shapes.json.
 *
 *   npm run shapes
 *
 * The output is checked in, so this only needs to run when a model changes. The models, a few megabytes
 * each, are read straight into memory: a copy kept in the shared temporary directory could be swapped
 * by another program between the check for it and its use.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SHAPE_SOURCES, type ShapeGrid } from "@/app/solar-system/shapes";
import { equalVolumeRadius, packGrid, parseObj, radiusGrid, unzipFirst } from "./shapes";

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { headers: { "User-Agent": "exofinder-shapes" } });
  if (!response.ok) throw new Error(`${url} answered with status ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  await mkdir(path.resolve("public/shapes"), { recursive: true });
  const grids: Record<string, ShapeGrid> = {};
  for (const [slug, source] of Object.entries(SHAPE_SOURCES)) {
    const raw = await download(source.download);
    const mesh = parseObj((source.zipped ? unzipFirst(raw) : raw).toString("utf8"));
    const grid = radiusGrid(mesh);
    const { bytes, maxRadius } = packGrid(grid);
    await writeFile(path.resolve("public/shapes", `${slug}.bin`), bytes);
    grids[slug] = { maxRadiusKm: Math.round(maxRadius * 1000) / 1000, meanRadiusKm: Math.round(equalVolumeRadius(grid) * 1000) / 1000 };
    console.log(`shapes/${slug}: ${mesh.triangles.length / 3} triangles, largest radius ${maxRadius.toFixed(2)} km, equal-volume radius ${grids[slug].meanRadiusKm} km`);
  }
  await writeFile(path.resolve("src/app/solar-system/shapes.json"), `${JSON.stringify(grids, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
