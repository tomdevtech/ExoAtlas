import { BULGE_WIDTH, GALACTIC_CENTRE, GALAXY_EDGE, GALAXY_PICTURE_WIDTH } from "./galaxy";

/**
 * The galaxy as a body, for the view from afar.
 *
 * The artist's impression is flat: seen from above it is right, but from an
 * angle all its light lies in one plane, and when the camera moves nothing
 * moves against anything else. A real galaxy has depth. Its young stars and
 * glowing gas lie in a thin layer, its old stars in a thicker one, its bulge
 * swells far above and below the plane, dust lanes lie across it, and a
 * faint halo of old stars surrounds it all.
 *
 * So the picture is only the plan, and is not drawn itself: it is turned
 * into clouds of light at different heights, and into clusters of stars. Where
 * it is bright there are many, in its colours. Bluish and pink places are
 * young and keep close to the plane; yellowish ones are old and spread
 * further; near the centre they swell into the bulge. Where the picture is
 * darker than its surroundings, dark clouds of dust lie in the plane.
 *
 * The real Milky Way is about a hundred times as wide as it is thick; drawn
 * like that it looks like a sheet of paper from the side. The heights here
 * are therefore drawn larger than they are (THICKER), as pictures of
 * galaxies usually do, and the bulge gets a body of its own.
 *
 * Lengths are parsecs in the coordinates of the map (galaxy.ts).
 */

/** How much higher than in nature the disc and the bulge are drawn, so that the eye sees a body. */
export const THICKER = 4.5;
/** How much higher than in nature the thin layer of the arms, their gas, young stars and dust is drawn. */
export const THIN = 1.6;

/** A cloud: position, colour as linear light, radius in parsecs, strength; eight numbers. */
export const CLOUD_STRIDE = 8;

export interface GalaxyClouds {
  /** Clouds of light. */
  light: Float32Array;
  /** Clouds of dust: their colour is unused, their strength is how much they hide. */
  dust: Float32Array;
  /** Clusters of stars as points of light, seven numbers each as in starfield.ts. */
  clusters: Float32Array;
}

/** How many clouds of each kind. Enough for depth, few enough to cost little. */
export const LIGHT_CLOUDS = 45_000;
export const DUST_CLOUDS = 16_000;
export const CLUSTERS = 16_000;
/** How much more than in proportion to its brightness a place brighter than its surroundings gets clouds, at most. */
const ARM_CONTRAST = 3;
export const HALO_CLOUDS = 450;
export const BULGE_CLOUDS = 3_000;
/** The light of the bulge of its own, as a share of the light of the picture. */
const BULGE_LIGHT = 0.3;
/** Half the width and half the height of the bulge, in parsecs: an oval. */
const BULGE_SIZE: [number, number] = [4500, 3700];

/** Mulberry32: small, fast, and the same on every machine. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number spread like a bell around 0 with spread 1 (Box and Muller). */
function bell(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-9))) * Math.cos(2 * Math.PI * rand());
}

/** The place of the galaxy at the middle of a pixel of the picture (row from the top). */
function place(column: number, row: number, size: number): [number, number] {
  // Towards the centre is up in the picture, the longitude of 90 degrees left.
  const x = GALACTIC_CENTRE[0] + (0.5 - (row + 0.5) / size) * GALAXY_PICTURE_WIDTH;
  const y = GALACTIC_CENTRE[1] + (0.5 - (column + 0.5) / size) * GALAXY_PICTURE_WIDTH;
  return [x, y];
}

/**
 * Clouds from a picture of the galaxy given as linear red, green and blue per
 * pixel, `size` × `size`, rows from the top. Always the same clouds for the
 * same picture.
 */
export function galaxyClouds(rgb: Float32Array, size: number): GalaxyClouds {
  const rand = random(271828);
  const pixel = GALAXY_PICTURE_WIDTH / size;
  const brightness = new Float32Array(size * size);
  for (let i = 0; i < brightness.length; i++) {
    brightness[i] = 0.3 * rgb[i * 3] + 0.6 * rgb[i * 3 + 1] + 0.1 * rgb[i * 3 + 2];
  }

  // Clouds of light where the picture is bright: pixels drawn in proportion
  // to their brightness, so a bright arm gets many clouds and a gap few.
  // The picture is bright between the arms too, with the smooth light of the
  // old disc, which the glow of the galaxy draws softly. So the clouds go
  // more than in proportion where the picture is brighter than its wider
  // surroundings: into the arms.
  const wider = blur(brightness, size, Math.max(2, Math.round(size / 28)));
  const cumulative = new Float64Array(brightness.length);
  let total = 0;
  for (let i = 0; i < brightness.length; i++) {
    const arm = Math.min(ARM_CONTRAST, brightness[i] / Math.max(wider[i], 1e-6));
    total += brightness[i] * arm * arm;
    cumulative[i] = total;
  }
  const pick = () => {
    const target = rand() * total;
    let low = 0;
    let high = cumulative.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (cumulative[middle] < target) low = middle + 1;
      else high = middle;
    }
    return low;
  };

  const light = new Float32Array((LIGHT_CLOUDS + HALO_CLOUDS + BULGE_CLOUDS) * CLOUD_STRIDE);
  // Each cloud carries an equal share of the light of the picture.
  const share = 1 / LIGHT_CLOUDS;
  for (let n = 0; n < LIGHT_CLOUDS; n++) {
    const index = pick();
    const row = Math.floor(index / size);
    const column = index - row * size;
    const [px, py] = place(column, row, size);
    const [red, green, blue] = [rgb[index * 3], rgb[index * 3 + 1], rgb[index * 3 + 2]];
    const sum = Math.max(red + green + blue, 1e-6);
    // Blue and pink light comes from young stars and their gas, which keep
    // close to the plane; yellow light from old stars, which spread further.
    const young = Math.min(1, Math.max(0, (blue - red) / sum * 4 + 0.5 + (red - green) / sum * 1.5));
    const x = px + (rand() - 0.5) * pixel;
    const y = py + (rand() - 0.5) * pixel;
    const fromCentre = Math.hypot(x - GALACTIC_CENTRE[0], y - GALACTIC_CENTRE[1]);
    // The bar in the middle is a little thicker than the disc around it.
    const bulge = Math.exp(-((fromCentre / (BULGE_WIDTH * 1.2)) ** 2));
    // The arms, their gas and young stars stay in a thin layer, a little
    // higher than in nature (THIN). The height of the galaxy is carried by
    // what has no arms: the smooth thick disc of old stars, drawn by the glow
    // of GALAXY_GLOW_FRAGMENT, the bulge and the halo (THICKER). Were the
    // arms as high, they would be smeared into streaks up and down when seen
    // at a slant.
    const disc = (60 + 220 * (1 - young)) * THIN;
    // Towards its edge the disc flares out a little.
    const height = disc * (1 + 0.8 * smoothstep(9000, GALAXY_EDGE, fromCentre)) + 400 * bulge * THIN;
    const z = bell(rand) * height;
    // Soft clouds: small ones would make the galaxy look grainy from afar.
    const radius = (young > 0.5 ? 90 : 200) + 200 * rand() + 500 * bulge;
    // The clouds of light are drawn without the brightness of their pixel,
    // as each already stands for an equal share: colour only.
    light.set([x, y, z, red / sum, green / sum, blue / sum, radius, share], n * CLOUD_STRIDE);
  }

  // A faint halo of old stars around everything, densest in the middle. Few
  // but wide clouds: they are drawn into the small picture of the glow, so
  // their size costs little.
  for (let n = 0; n < HALO_CLOUDS; n++) {
    const r = 1200 + 16000 * rand() ** 1.8;
    const cos = 2 * rand() - 1;
    const sin = Math.sqrt(1 - cos * cos);
    const angle = 2 * Math.PI * rand();
    light.set(
      [
        GALACTIC_CENTRE[0] + r * sin * Math.cos(angle),
        GALACTIC_CENTRE[1] + r * sin * Math.sin(angle),
        // A little flattened, as the halo is.
        r * cos * 0.65,
        0.38,
        0.34,
        0.28,
        2500 + 2500 * rand(),
        share * 4,
      ],
      (LIGHT_CLOUDS + n) * CLOUD_STRIDE,
    );
  }

  // The bulge: an oval swarm of old yellowish stars in the middle, packed
  // densest at its heart, which swells far above and below the disc.
  for (let n = 0; n < BULGE_CLOUDS; n++) {
    // Distance from the middle in units of the size of the bulge, densest inside.
    const r = Math.min(1.6, 0.5 / Math.sqrt(Math.max(rand(), 1e-6) ** (-2 / 3) - 1));
    const cos = 2 * rand() - 1;
    const sin = Math.sqrt(1 - cos * cos);
    const angle = 2 * Math.PI * rand();
    light.set(
      [
        GALACTIC_CENTRE[0] + r * BULGE_SIZE[0] * sin * Math.cos(angle),
        GALACTIC_CENTRE[1] + r * BULGE_SIZE[0] * sin * Math.sin(angle),
        r * BULGE_SIZE[1] * cos,
        0.42,
        0.34,
        0.24,
        // Wide, so that they melt into one body instead of single puffs.
        700 + 900 * rand(),
        BULGE_LIGHT / BULGE_CLOUDS,
      ],
      (LIGHT_CLOUDS + HALO_CLOUDS + n) * CLOUD_STRIDE,
    );
  }

  // Clouds of dust where the picture is darker than its surroundings.
  const blurred = blur(brightness, size, Math.max(2, Math.round(size / 64)));
  const darkness = new Float32Array(brightness.length);
  let dark = 0;
  for (let i = 0; i < brightness.length; i++) {
    const row = Math.floor(i / size);
    const [px, py] = place(i - row * size, row, size);
    const fromCentre = Math.hypot(px - GALACTIC_CENTRE[0], py - GALACTIC_CENTRE[1]);
    // None in and around the bulge, where the bright bar would make every
    // place beside it look dark, and none beyond the edge of the disc.
    const inDisc = smoothstep(2600, 4500, fromCentre) * (1 - smoothstep(GALAXY_EDGE * 0.8, GALAXY_EDGE, fromCentre));
    // A lane of dust still lets some light through; beyond the edge of the
    // disc there is none, and that is empty space, not dust.
    const lit = smoothstep(0.03, 0.12, brightness[i] / Math.max(blurred[i], 1e-6));
    // Squared, so the dust gathers in the clear dark lanes rather than
    // spreading thinly over every slight shadow of the picture.
    darkness[i] = Math.max(0, blurred[i] - brightness[i]) ** 2 * inDisc * lit;
    dark += darkness[i];
  }
  const dust = new Float32Array(DUST_CLOUDS * CLOUD_STRIDE);
  let cumulativeDark = 0;
  const darkCumulative = new Float64Array(darkness.length);
  for (let i = 0; i < darkness.length; i++) {
    cumulativeDark += darkness[i];
    darkCumulative[i] = cumulativeDark;
  }
  for (let n = 0; n < DUST_CLOUDS && dark > 0; n++) {
    const target = rand() * dark;
    let low = 0;
    let high = darkCumulative.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (darkCumulative[middle] < target) low = middle + 1;
      else high = middle;
    }
    const row = Math.floor(low / size);
    const [px, py] = place(low - row * size, row, size);
    dust.set(
      [
        px + (rand() - 0.5) * pixel,
        py + (rand() - 0.5) * pixel,
        bell(rand) * 55 * THIN,
        0,
        0,
        0,
        // Wide and faint, so that many overlap into smooth lanes instead of
        // standing out one by one.
        100 + 140 * rand(),
        0.5 + 0.5 * rand(),
      ],
      n * CLOUD_STRIDE,
    );
  }

  // Clusters of stars where the picture is bright: young bright ones close
  // to the plane where it is blue, older and fainter ones above and below.
  // From afar they make the arms a field of points rather than a painting.
  const clusters = new Float32Array(CLUSTERS * 7);
  for (let n = 0; n < CLUSTERS; n++) {
    const index = pick();
    const row = Math.floor(index / size);
    const column = index - row * size;
    const [px, py] = place(column, row, size);
    const [red, green, blue] = [rgb[index * 3], rgb[index * 3 + 1], rgb[index * 3 + 2]];
    const sum = Math.max(red + green + blue, 1e-6);
    const young = Math.min(1, Math.max(0, (blue - red) / sum * 4 + 0.5));
    const top = Math.max(red, green, blue, 1e-6);
    clusters.set(
      [
        px + (rand() - 0.5) * pixel,
        py + (rand() - 0.5) * pixel,
        bell(rand) * (60 + 400 * (1 - young)) * THIN,
        // Whiter than the picture: the colour of single stars, not of a haze.
        0.55 + 0.45 * (red / top),
        0.55 + 0.45 * (green / top),
        0.55 + 0.45 * (blue / top),
        // Tens of thousands of suns, and a few far more.
        (20_000 + 400_000 * rand() ** 4) * (0.4 + 0.6 * young),
      ],
      n * 7,
    );
  }
  return { light, dust, clusters };
}

/** A square blur of `reach` pixels each way. */
function blur(values: Float32Array, size: number, reach: number): Float32Array {
  const across = new Float32Array(values.length);
  const out = new Float32Array(values.length);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      let sum = 0;
      let count = 0;
      for (let d = -reach; d <= reach; d++) {
        const c = column + d;
        if (c < 0 || c >= size) continue;
        sum += values[row * size + c];
        count++;
      }
      across[row * size + column] = sum / count;
    }
  }
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      let sum = 0;
      let count = 0;
      for (let d = -reach; d <= reach; d++) {
        const r = row + d;
        if (r < 0 || r >= size) continue;
        sum += across[r * size + column];
        count++;
      }
      out[row * size + column] = sum / count;
    }
  }
  return out;
}

function smoothstep(low: number, high: number, value: number): number {
  const t = Math.min(Math.max((value - low) / (high - low), 0), 1);
  return t * t * (3 - 2 * t);
}
