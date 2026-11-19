/**
 * Turns the published global mosaics of moons and dwarf planets into the textures of the 3D model.
 *
 * The mosaics differ in where they put longitude 0, in colour and in exposure, and some leave the parts
 * no spacecraft saw black. Every texture leaves here with longitude 0 in the middle, colours a camera
 * could plausibly see, a brightness that follows the body's albedo, and unseen parts filled with a
 * smooth continuation of the neighbouring tones: they carry no invented craters or ridges.
 */

/** An image as 8-bit RGB, row by row from the north. */
export interface Picture {
  width: number;
  height: number;
  rgb: Uint8Array;
}

export type Colouring =
  /** A colour mosaic, whose saturation is scaled (below 1 for exaggerated or false colours). */
  | { kind: "colour"; saturation: number }
  /** A greyscale mosaic, tinted from the colour of its dark ground to the colour of its bright ground. */
  | { kind: "grey"; dark: string; bright: string }
  /** Titan: its haze in the colour given, with the near-infrared surface showing through faintly. */
  | { kind: "haze"; color: string };

export interface MapRecipe {
  /** Whether the mosaic has longitude 180 in its middle and must be turned by half a turn. */
  centredOn180: boolean;
  colouring: Colouring;
  /** The body's visual albedo, which sets the average brightness of the texture. */
  albedo: number;
}

/** Pixels this dark in every channel are taken as "not imaged". */
const NO_DATA = 6;

/** Turns the picture about the axis by half a turn, which moves longitude 180 from the middle to the edges. */
export function halfTurn({ width, height, rgb }: Picture): Picture {
  const out = new Uint8Array(rgb.length);
  const half = Math.floor(width / 2);
  for (let y = 0; y < height; y++) {
    const row = y * width * 3;
    out.set(rgb.subarray(row + half * 3, row + width * 3), row);
    out.set(rgb.subarray(row, row + half * 3), row + (width - half) * 3);
  }
  return { width, height, rgb: out };
}

/**
 * Marks the pixels that were never imaged, grown by `margin` pixels so that the dark fringe the scaling
 * leaves along their edge is replaced as well.
 */
export function findGaps({ width, height, rgb }: Picture, margin = 2): Uint8Array {
  let mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    if (rgb[i * 3] <= NO_DATA && rgb[i * 3 + 1] <= NO_DATA && rgb[i * 3 + 2] <= NO_DATA) mask[i] = 1;
  }
  for (let step = 0; step < margin; step++) {
    const grown = mask.slice();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (mask[y * width + x]) continue;
        const left = (x + width - 1) % width;
        const right = (x + 1) % width;
        if (
          mask[y * width + left] ||
          mask[y * width + right] ||
          (y > 0 && mask[(y - 1) * width + x]) ||
          (y < height - 1 && mask[(y + 1) * width + x])
        ) {
          grown[y * width + x] = 1;
        }
      }
    }
    mask = grown;
  }
  return mask;
}

/** The colour of a "#rrggbb" string, from 0 to 1. */
function color(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * The average brightness (0 to 1, as stored) a texture gets for an albedo. Photographs are exposed for
 * their subject, so the real range from coal-dark Ceres to snow-white Enceladus is compressed; the order
 * stays.
 */
export function targetBrightness(albedo: number): number {
  return Math.min(0.82, 0.28 + 0.5 * Math.sqrt(albedo));
}

/** Applies the colouring and the brightness of `recipe` to the imaged pixels; gaps are left as they are. */
export function colourise(picture: Picture, gaps: Uint8Array, recipe: MapRecipe): Picture {
  const { width, height, rgb } = picture;
  const count = width * height;
  const out = new Float32Array(count * 3);
  const colouring = recipe.colouring;
  const dark = colouring.kind === "grey" ? color(colouring.dark) : [0, 0, 0];
  const bright = colouring.kind === "grey" ? color(colouring.bright) : [0, 0, 0];
  const haze = colouring.kind === "haze" ? color(colouring.color) : [0, 0, 0];

  // The mean grey of the imaged part, around which Titan's surface varies.
  let greySum = 0;
  let imaged = 0;
  for (let i = 0; i < count; i++) {
    if (gaps[i]) continue;
    greySum += luminance(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]) / 255;
    imaged++;
  }
  const meanGrey = imaged > 0 ? greySum / imaged : 0.5;

  for (let i = 0; i < count; i++) {
    if (gaps[i]) continue;
    const r = rgb[i * 3] / 255;
    const g = rgb[i * 3 + 1] / 255;
    const b = rgb[i * 3 + 2] / 255;
    const grey = luminance(r, g, b);
    let pixel: [number, number, number];
    if (colouring.kind === "colour") {
      const s = colouring.saturation;
      pixel = [grey + (r - grey) * s, grey + (g - grey) * s, grey + (b - grey) * s];
    } else if (colouring.kind === "grey") {
      // The tint runs from the dark to the bright ground, scaled so that it keeps the grey's brightness.
      const tint = [0, 1, 2].map((c) => dark[c] + (bright[c] - dark[c]) * grey);
      const tintLight = luminance(tint[0], tint[1], tint[2]) || 1;
      pixel = [tint[0] * (grey / tintLight), tint[1] * (grey / tintLight), tint[2] * (grey / tintLight)];
    } else {
      // Through the haze the bright and dark lands only change the light by a few per cent.
      const shade = 1 + 0.15 * (grey - meanGrey);
      pixel = [haze[0] * shade, haze[1] * shade, haze[2] * shade];
    }
    out.set(pixel, i * 3);
  }

  // Bends the tones of the imaged part with a power curve until their mean is the brightness the albedo
  // calls for. Unlike a plain gain this never clips the bright ground to white.
  const histogram = new Float64Array(256);
  for (let i = 0; i < count; i++) {
    if (gaps[i]) continue;
    const light = luminance(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
    histogram[Math.min(255, Math.max(0, Math.round(light * 255)))]++;
  }
  const meanAt = (power: number) => {
    let sum = 0;
    for (let level = 1; level < 256; level++) sum += histogram[level] * (level / 255) ** power;
    return sum / (imaged || 1);
  };
  let power = 1;
  if (colouring.kind !== "haze" && imaged > 0) {
    const target = targetBrightness(recipe.albedo);
    // The mean falls as the power rises, so bisection finds it.
    let low = 0.1;
    let high = 10;
    for (let step = 0; step < 40; step++) {
      power = Math.sqrt(low * high);
      if (meanAt(power) > target) low = power;
      else high = power;
    }
  }
  const result = new Uint8Array(rgb.length);
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 3; c++) {
      result[i * 3 + c] = gaps[i] ? rgb[i * 3 + c] : Math.round(Math.min(1, Math.max(0, out[i * 3 + c])) ** power * 255);
    }
  }
  return { width, height, rgb: result };
}

/**
 * Fills the gaps with a smooth continuation of the surrounding tones. The picture is averaged into coarse
 * cells, empty cells take the mean of their neighbours until the values settle (wrapping round in
 * longitude), and gap pixels read the result with bilinear interpolation.
 */
export function fillGaps(picture: Picture, gaps: Uint8Array, cell = 8): Picture {
  const { width, height, rgb } = picture;
  const cw = Math.ceil(width / cell);
  const ch = Math.ceil(height / cell);
  let grid = new Float32Array(cw * ch * 3);
  const known = new Uint8Array(cw * ch);
  const weight = new Float32Array(cw * ch);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (gaps[i]) continue;
      const c = Math.floor(y / cell) * cw + Math.floor(x / cell);
      for (let k = 0; k < 3; k++) grid[c * 3 + k] += rgb[i * 3 + k];
      weight[c]++;
    }
  }
  let any = false;
  let mean = [0, 0, 0];
  let total = 0;
  for (let c = 0; c < cw * ch; c++) {
    if (weight[c] === 0) continue;
    known[c] = 1;
    any = true;
    for (let k = 0; k < 3; k++) {
      mean[k] += grid[c * 3 + k];
      grid[c * 3 + k] /= weight[c];
    }
    total += weight[c];
  }
  if (!any) return picture;
  mean = mean.map((value) => value / total);
  for (let c = 0; c < cw * ch; c++) if (!known[c]) grid.set(mean, c * 3);

  // The edge of a mosaic is where the images met the terminator: bright sunlit slopes and long shadows,
  // which the relaxation below would draw out into streaks. The grid only feeds the fill, so the imaged
  // cells are smoothed first, each weighted by how many imaged pixels it holds; the fill then continues
  // the broad tones and not single spots.
  for (let round = 0; round < 40; round++) {
    const next = grid.slice();
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const c = y * cw + x;
        if (!known[c]) continue;
        const around = [c, y * cw + ((x + cw - 1) % cw), y * cw + ((x + 1) % cw)];
        if (y > 0) around.push(c - cw);
        if (y < ch - 1) around.push(c + cw);
        let sum = 0;
        for (const n of around) if (known[n]) sum += weight[n];
        for (let k = 0; k < 3; k++) {
          let value = 0;
          for (const n of around) if (known[n]) value += grid[n * 3 + k] * weight[n];
          next[c * 3 + k] = value / sum;
        }
      }
    }
    grid = next;
  }

  // Relaxes the unknown cells towards the mean of their neighbours. A few hundred rounds reach far enough
  // for a gap as large as a hemisphere at this cell size.
  for (let round = 0; round < 600; round++) {
    const next = grid.slice();
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const c = y * cw + x;
        if (known[c]) continue;
        const neighbours = [y * cw + ((x + cw - 1) % cw), y * cw + ((x + 1) % cw)];
        if (y > 0) neighbours.push(c - cw);
        if (y < ch - 1) neighbours.push(c + cw);
        for (let k = 0; k < 3; k++) {
          let sum = 0;
          for (const n of neighbours) sum += grid[n * 3 + k];
          next[c * 3 + k] = sum / neighbours.length;
        }
      }
    }
    grid = next;
  }

  const out = rgb.slice();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!gaps[i]) continue;
      const gx = (x + 0.5) / cell - 0.5;
      const gy = Math.min(Math.max((y + 0.5) / cell - 0.5, 0), ch - 1);
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = gx - x0;
      const fy = gy - y0;
      const at = (cx: number, cy: number, k: number) => grid[(Math.min(cy, ch - 1) * cw + ((cx % cw) + cw) % cw) * 3 + k];
      for (let k = 0; k < 3; k++) {
        const top = at(x0, y0, k) * (1 - fx) + at(x0 + 1, y0, k) * fx;
        const bottom = at(x0, y0 + 1, k) * (1 - fx) + at(x0 + 1, y0 + 1, k) * fx;
        out[i * 3 + k] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }
  return { width, height, rgb: out };
}

/** The whole treatment of one mosaic, already scaled to its final size. Also returns the share that was filled. */
export function prepareMap(picture: Picture, recipe: MapRecipe): { picture: Picture; filled: number } {
  const turned = recipe.centredOn180 ? halfTurn(picture) : picture;
  // The limb of a mosaic is often darkened over a few original pixels, so the margin grows with the size.
  const gaps = findGaps(turned, Math.max(2, Math.round(turned.width / 512)));
  const filled = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
  return { picture: fillGaps(colourise(turned, gaps, recipe), gaps), filled };
}
