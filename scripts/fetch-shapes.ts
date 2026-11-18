/**
 * Downloads the shape models of the irregular bodies and writes their radius grids (scripts/shapes.ts)
 * to public/shapes/<slug>.bin, and the scale of each grid to src/app/solar-system/shapes.json.
 *
 *   npm run shapes
 *
 * The output is checked in, so this only needs to run when a model changes. The downloads stay in the
 * system's temporary directory for the next run.
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SHAPE_SOURCES, type ShapeGrid } from "@/app/solar-system/shapes";
import { equalVolumeRadius, packGrid, parseObj, radiusGrid, unzipFirst } from "./shapes";

async function download(url: string, directory: string): Promise<Buffer> {
  const file = path.join(directory, path.basename(new URL(url).pathname));
  try {
    await access(file);
  } catch {
    const response = await fetch(url, { headers: { "User-Agent": "exofinder-shapes" } });
    if (!response.ok) throw new Error(`${url} answered with status ${response.status}`);
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
  }
  return readFile(file);
}

async function main() {
  const downloads = path.join(tmpdir(), "exofinder-shapes");
  await mkdir(downloads, { recursive: true });
  await mkdir(path.resolve("public/shapes"), { recursive: true });
  const grids: Record<string, ShapeGrid> = {};
  for (const [slug, source] of Object.entries(SHAPE_SOURCES)) {
    const raw = await download(source.download, downloads);
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
