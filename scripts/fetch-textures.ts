/**
 * Downloads planet, Milky Way and galaxy textures and stores scaled copies in public/textures.
 *
 *   npm run textures
 *
 * The output is checked in, so this only needs to run when a size or source changes.
 * Credits and licences are listed in public/textures/README.md.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const SOLAR_SYSTEM_SCOPE = "https://www.solarsystemscope.com/textures/download/";
const ESO_PANORAMA = "https://cdn.eso.org/images/large/eso0932a.jpg";
const ESO_GALAXY = "https://cdn.eso.org/images/large/eso1339g.jpg";
const OUT = path.resolve("public/textures");

/** Source file name and local name of each surface map. */
const PLANET_MAPS: [source: string, name: string][] = [
  ["2k_mercury.jpg", "mercury"],
  ["2k_venus_atmosphere.jpg", "venus"],
  ["2k_earth_daymap.jpg", "earth"],
  ["2k_earth_nightmap.jpg", "earth-night"],
  ["2k_earth_clouds.jpg", "earth-clouds"],
  ["2k_mars.jpg", "mars"],
  ["2k_jupiter.jpg", "jupiter"],
  ["2k_saturn.jpg", "saturn"],
  ["2k_uranus.jpg", "uranus"],
  ["2k_neptune.jpg", "neptune"],
];

async function download(url: string, directory: string): Promise<string> {
  const response = await fetch(url, { headers: { "User-Agent": "exofinder-textures" } });
  if (!response.ok) throw new Error(`${url} answered with status ${response.status}`);
  const file = path.join(directory, path.basename(new URL(url).pathname));
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

async function main() {
  const downloads = await mkdtemp(path.join(tmpdir(), "exofinder-textures-"));
  await mkdir(path.join(OUT, "planets"), { recursive: true });
  await mkdir(path.join(OUT, "sky"), { recursive: true });

  for (const [source, name] of PLANET_MAPS) {
    const file = await download(SOLAR_SYSTEM_SCOPE + source, downloads);
    // Large for the 3D model, small for list thumbnails.
    await sharp(file)
      .resize(2048, 1024)
      .jpeg({ quality: 80, mozjpeg: true })
      .toFile(path.join(OUT, "planets", `${name}-lg.jpg`));
    await sharp(file)
      .resize(512, 256)
      .jpeg({ quality: 78, mozjpeg: true })
      .toFile(path.join(OUT, "planets", `${name}-sm.jpg`));
    console.log(`planets/${name}`);
  }

  // The ring texture holds colour and alpha from the inner to the outer edge, so a thin strip is enough.
  const ring = await download(SOLAR_SYSTEM_SCOPE + "2k_saturn_ring_alpha.png", downloads);
  await sharp(ring)
    .resize(1024, 4, { fit: "fill" })
    .png()
    .toFile(path.join(OUT, "planets", "saturn-ring.png"));
  console.log("planets/saturn-ring");

  const sun = await download(SOLAR_SYSTEM_SCOPE + "2k_sun.jpg", downloads);
  await sharp(sun)
    .resize(1024, 512)
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(path.join(OUT, "planets", "sun-lg.jpg"));
  console.log("planets/sun");

  // The sky panorama is in galactic coordinates with the galactic centre in the middle.
  const panorama = await download(ESO_PANORAMA, downloads);
  await sharp(panorama)
    .resize(4096, 2048)
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(path.join(OUT, "sky", "milky-way-lg.jpg"));
  await sharp(panorama)
    .resize(2048, 1024)
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(path.join(OUT, "sky", "milky-way-sm.jpg"));
  console.log("sky/milky-way");

  // The map samples this top-down galaxy view at 512 px (scene/galaxyView.ts).
  // 1024 px leaves headroom for downscaling, and more would only waste bandwidth.
  const galaxy = await download(ESO_GALAXY, downloads);
  await sharp(galaxy)
    .resize(1024, 1024, { kernel: "lanczos3" })
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(path.join(OUT, "sky", "galaxy.jpg"));
  console.log("sky/galaxy");

  console.log(`Done. The downloads are in ${downloads} and can be deleted.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
