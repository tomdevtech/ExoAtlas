/**
 * Downloads the surface maps of the solar system, the panorama of the Milky
 * Way and the picture of the galaxy from outside, and stores them, scaled
 * down, in public/textures.
 *
 *   npm run textures
 *
 * The results are checked in, so this only has to run again when a size or a
 * source changes. Credits and licences: public/textures/README.md.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const SOLAR_SYSTEM_SCOPE = "https://www.solarsystemscope.com/textures/download/";
const ESO_PANORAMA = "https://cdn.eso.org/images/large/eso0932a.jpg";
const ESO_GALAXY = "https://cdn.eso.org/images/large/eso1339g.jpg";
const OUT = path.resolve("public/textures");

/** Surface maps: file at the source and the name we store it under. */
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
    // Large for the 3D model, small for the images in lists.
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

  // The rings of Saturn: colour and transparency from the inner to the outer edge.
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

  // The sky as seen from the Sun, in galactic coordinates with the galactic
  // centre in the middle.
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

  // The galaxy from above, as an artist drew it: the galactic centre in the
  // middle, the Sun below it (src/app/map/galaxy.ts). The map reads it at
  // 512 pixels (scene/galaxyView.ts); twice that leaves room for the
  // shrinking, and more would only be downloaded for nothing.
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
