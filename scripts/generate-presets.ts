/**
 * Simulates the base maps ("presets") the exoplanets are drawn from and
 * stores them in public/textures/presets.
 *
 *   npm run presets
 *
 * A preset holds no colours, only what shaped the surface. The shader
 * (surface.glsl.ts) turns it into a planet with the values of that planet:
 * sea level, ice, lava, colours, turn and mirroring. So a handful of presets
 * gives thousands of different planets, and the same planet always looks the same.
 *
 * Rocky presets (red, green, blue):
 *   height after erosion · where water gathers (valleys and rivers; cracks on
 *   ice crusts) · craters (0.5 is level ground)
 * Banded presets for gas giants:
 *   belts and zones · a second tracer for streaks · storms
 *
 * Everything is seeded, so a run always gives the same files. They are
 * checked in; this only runs again when the simulation changes.
 *
 * What the app has to know about a preset goes into presets.json next to the
 * planet code: for rocky presets the heights below which each share of the
 * surface lies (for choosing a sea level), for banded presets the winds they
 * were simulated with (so the clouds can drift on the same way).
 *
 * `npm run presets` calls this twice: `terrain 1024` and `bands 2048`. Rocky
 * presets are simulated at half the size and enlarged, because single
 * raindrops leave a grain at full size that shows as speckled coasts. The
 * fine threads of the gas giants need the full size.
 * PRESET_ONLY=name limits a trial run to some presets. PRESET_DIR=folder
 * writes the maps and presets.json there instead: the tests use that.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const KIND = process.argv[2] as "terrain" | "bands" | undefined;
const W = Number(process.argv[3] ?? 2048);
const H = W / 2;
const ONLY = process.env.PRESET_ONLY?.split(",");
const DIR = process.env.PRESET_DIR;
const OUT = path.resolve(DIR ?? "public/textures/presets");
const META = DIR ? path.join(OUT, "presets.json") : path.resolve("src/app/planets/globe/presets.json");

// ---- Random numbers and noise ------------------------------------------------

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

/** Perlin noise in three dimensions, about -0.7 to 0.7. */
class Noise {
  private readonly perm = new Uint8Array(512);

  constructor(seed: number) {
    const rand = random(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  at(x: number, y: number, z: number): number {
    const perm = this.perm;
    const xf = Math.floor(x);
    const yf = Math.floor(y);
    const zf = Math.floor(z);
    const X = xf & 255;
    const Y = yf & 255;
    const Z = zf & 255;
    x -= xf;
    y -= yf;
    z -= zf;
    const u = x * x * x * (x * (x * 6 - 15) + 10);
    const v = y * y * y * (y * (y * 6 - 15) + 10);
    const w = z * z * z * (z * (z * 6 - 15) + 10);
    const A = perm[X] + Y;
    const AA = perm[A] + Z;
    const AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y;
    const BA = perm[B] + Z;
    const BB = perm[B + 1] + Z;
    const g = (hash: number, gx: number, gy: number, gz: number) => {
      const h = hash & 15;
      const a = h < 8 ? gx : gy;
      const b = h < 4 ? gy : h === 12 || h === 14 ? gx : gz;
      return ((h & 1) === 0 ? a : -a) + ((h & 2) === 0 ? b : -b);
    };
    const x1 = x - 1;
    const y1 = y - 1;
    const z1 = z - 1;
    const l1 = g(perm[AA], x, y, z) + u * (g(perm[BA], x1, y, z) - g(perm[AA], x, y, z));
    const l2 = g(perm[AB], x, y1, z) + u * (g(perm[BB], x1, y1, z) - g(perm[AB], x, y1, z));
    const l3 =
      g(perm[AA + 1], x, y, z1) + u * (g(perm[BA + 1], x1, y, z1) - g(perm[AA + 1], x, y, z1));
    const l4 =
      g(perm[AB + 1], x, y1, z1) +
      u * (g(perm[BB + 1], x1, y1, z1) - g(perm[AB + 1], x, y1, z1));
    const m1 = l1 + v * (l2 - l1);
    const m2 = l3 + v * (l4 - l3);
    return (m1 + w * (m2 - m1)) * 0.7;
  }

  /** Several layers, each twice as fine and half as strong. About -0.6 to 0.6. */
  fbm(x: number, y: number, z: number, octaves: number): number {
    let sum = 0;
    let amp = 0.5;
    let total = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.at(x, y, z);
      total += amp;
      x = x * 2.02 + 19.1;
      y = y * 2.02 + 7.7;
      z = z * 2.02 + 13.3;
      amp *= 0.5;
    }
    return sum / total;
  }

  /** Sharp ridges, 0 to 1. */
  ridged(x: number, y: number, z: number, octaves: number): number {
    let sum = 0;
    let amp = 0.5;
    let total = 0;
    let weight = 1;
    for (let i = 0; i < octaves; i++) {
      let n = 1 - Math.abs(this.at(x, y, z) * 1.6);
      n *= n * weight;
      weight = Math.min(1, Math.max(0, n * 2));
      sum += amp * n;
      total += amp;
      x = x * 2.03 + 5.1;
      y = y * 2.03 + 9.7;
      z = z * 2.03 + 2.3;
      amp *= 0.5;
    }
    return sum / total;
  }
}

// ---- The grid ----------------------------------------------------------------

/** Unit vector of each pixel: longitude across, latitude up, as the shader reads maps. */
const PX = new Float32Array(W * H);
const PY = new Float32Array(W * H);
const PZ = new Float32Array(W * H);
/** Width of a pixel at each row, compared with the equator. */
const COS = new Float32Array(H);
for (let y = 0; y < H; y++) {
  const lat = (0.5 - (y + 0.5) / H) * Math.PI;
  COS[y] = Math.max(Math.cos(lat), 0.12);
  for (let x = 0; x < W; x++) {
    const lon = ((x + 0.5) / W - 0.5) * 2 * Math.PI;
    const i = y * W + x;
    PX[i] = Math.cos(lat) * Math.sin(lon);
    PY[i] = Math.sin(lat);
    PZ[i] = Math.cos(lat) * Math.cos(lon);
  }
}

function randomDirection(rand: () => number): [number, number, number] {
  const y = rand() * 2 - 1;
  const lon = rand() * 2 * Math.PI;
  const r = Math.sqrt(1 - y * y);
  return [r * Math.sin(lon), y, r * Math.cos(lon)];
}

/** Pixel column and row of a direction, as fractions. */
function toPixel(x: number, y: number, z: number): [number, number] {
  const lon = Math.atan2(x, z);
  const lat = Math.asin(Math.max(-1, Math.min(1, y)));
  return [(lon / (2 * Math.PI) + 0.5) * W - 0.5, (0.5 - lat / Math.PI) * H - 0.5];
}

/** The angle between two unit vectors, safe against rounding just outside -1 to 1. */
const angle = (dot: number) => Math.acos(Math.min(1, Math.max(-1, dot)));

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---- Rocky planets -----------------------------------------------------------

interface Terrain {
  name: string;
  seed: number;
  /** Number of tectonic plates and the share of them that carries continents. */
  plates: number;
  continental: number;
  /** How far continents stand above the sea floors: 1 for sharp continents, less for blotchy lowlands. */
  split: number;
  /** Strength of the general unevenness and of the mountain belts. */
  relief: number;
  mountains: number;
  /** Shield volcanoes. */
  volcanoes: number;
  /** Lowlands are levelled to plains by this much, 0 to 1. */
  plains: number;
  /** Raindrops per pixel and how hard they carve. */
  rain: number;
  carve: number;
  /** Number of craters and the angular radius of the largest. */
  craters: number;
  craterMax: number;
  /** Cracks in a crust of ice, instead of rivers. */
  cracks: number;
}

const TERRAINS: Terrain[] = [
  // Several continents with mountain belts where plates collide.
  { name: "continents", seed: 11, plates: 14, continental: 0.42, split: 1, relief: 1, mountains: 1, volcanoes: 0, plains: 0.3, rain: 0.5, carve: 1, craters: 40, craterMax: 0.03, cracks: 0 },
  // Many small plates: chains of islands and small continents.
  { name: "archipelago", seed: 23, plates: 26, continental: 0.35, split: 0.9, relief: 1.25, mountains: 0.8, volcanoes: 30, plains: 0.2, rain: 0.45, carve: 1, craters: 30, craterMax: 0.03, cracks: 0 },
  // Few plates: one large landmass and a wide ocean.
  { name: "supercontinent", seed: 37, plates: 7, continental: 0.45, split: 1, relief: 0.9, mountains: 1.2, volcanoes: 0, plains: 0.35, rain: 0.55, carve: 1.1, craters: 30, craterMax: 0.03, cracks: 0 },
  // An old dry world: wide plains, canyons cut long ago, dunes, some craters.
  { name: "desert", seed: 41, plates: 9, continental: 0.5, split: 0.45, relief: 1.1, mountains: 0.7, volcanoes: 6, plains: 0.6, rain: 0.35, carve: 1.4, craters: 500, craterMax: 0.07, cracks: 0 },
  // No weather, no plates: craters upon craters, like Mercury or the Moon.
  { name: "cratered", seed: 53, plates: 5, continental: 0.5, split: 0.25, relief: 0.4, mountains: 0.15, volcanoes: 0, plains: 0.7, rain: 0, carve: 0, craters: 9000, craterMax: 0.16, cracks: 0 },
  // Shield volcanoes and lava plains; lava runs down the channels.
  { name: "volcanic", seed: 67, plates: 10, continental: 0.5, split: 0.5, relief: 0.8, mountains: 0.5, volcanoes: 90, plains: 0.5, rain: 0.12, carve: 0.8, craters: 150, craterMax: 0.05, cracks: 0 },
  // A rugged young world: many plates, high ranges, deep valleys.
  { name: "highlands", seed: 83, plates: 19, continental: 0.6, split: 0.7, relief: 1.4, mountains: 1.4, volcanoes: 10, plains: 0.15, rain: 0.6, carve: 1.3, craters: 60, craterMax: 0.04, cracks: 0 },
  // An old surface: a few giant impact basins filled to plains, like the Moon or Mars.
  { name: "basins", seed: 97, plates: 6, continental: 0.5, split: 0.35, relief: 0.7, mountains: 0.3, volcanoes: 12, plains: 0.75, rain: 0.15, carve: 0.6, craters: 1400, craterMax: 0.24, cracks: 0 },
  // A smooth shell of ice, crossed by long cracks, like Europa.
  { name: "icecrust", seed: 79, plates: 8, continental: 0.5, split: 0.15, relief: 0.5, mountains: 0.1, volcanoes: 0, plains: 0.5, rain: 0, carve: 0, craters: 120, craterMax: 0.04, cracks: 650 },
];

/** The height before any weather: plates, mountain belts, volcanoes. */
function buildTerrain(t: Terrain): Float32Array {
  const rand = random(t.seed);
  const noise = new Noise(t.seed * 7 + 1);
  const K = t.plates;
  const cx = new Float32Array(K);
  const cy = new Float32Array(K);
  const cz = new Float32Array(K);
  // Each plate turns slowly about its own axis; that is its drift.
  const ox = new Float32Array(K);
  const oy = new Float32Array(K);
  const oz = new Float32Array(K);
  const base = new Float32Array(K);
  const land = new Uint8Array(K);
  for (let k = 0; k < K; k++) {
    [cx[k], cy[k], cz[k]] = randomDirection(rand);
    const [ax, ay, az] = randomDirection(rand);
    const speed = 0.5 + rand();
    ox[k] = ax * speed;
    oy[k] = ay * speed;
    oz[k] = az * speed;
    land[k] = rand() < t.continental ? 1 : 0;
    base[k] = (land[k] ? 0.1 + 0.12 * rand() : -0.34 - 0.12 * rand()) * t.split;
  }

  const volcanoes: { x: number; y: number; z: number; radius: number; height: number }[] = [];
  for (let v = 0; v < t.volcanoes; v++) {
    const [x, y, z] = randomDirection(rand);
    const size = Math.pow(rand(), 2.5);
    volcanoes.push({ x, y, z, radius: 0.025 + 0.11 * size, height: 0.12 + 0.3 * size });
  }

  const h = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const px = PX[i];
    const py = PY[i];
    const pz = PZ[i];

    // Bent coordinates give ragged plate edges instead of straight lines.
    let wx = px + 0.42 * noise.fbm(px * 1.7 + 31.7, py * 1.7, pz * 1.7, 6);
    let wy = py + 0.42 * noise.fbm(px * 1.7, py * 1.7 + 67.1, pz * 1.7, 6);
    let wz = pz + 0.42 * noise.fbm(px * 1.7, py * 1.7, pz * 1.7 + 11.9, 6);
    const wl = Math.hypot(wx, wy, wz);
    wx /= wl;
    wy /= wl;
    wz /= wl;

    let first = 0;
    let second = 0;
    let best = -2;
    let next = -2;
    for (let k = 0; k < K; k++) {
      const d = wx * cx[k] + wy * cy[k] + wz * cz[k];
      if (d > best) {
        next = best;
        second = first;
        best = d;
        first = k;
      } else if (d > next) {
        next = d;
        second = k;
      }
    }
    // Distance to the edge between the two nearest plates, in radians.
    const edge = (angle(next) - angle(best)) / 2;

    // Do the two plates move towards each other here (above 0) or apart?
    let tx = cx[second] - cx[first];
    let ty = cy[second] - cy[first];
    let tz = cz[second] - cz[first];
    const along = tx * wx + ty * wy + tz * wz;
    tx -= wx * along;
    ty -= wy * along;
    tz -= wz * along;
    const tl = Math.hypot(tx, ty, tz) || 1;
    const dx = oy[first] * wz - oz[first] * wy - (oy[second] * wz - oz[second] * wy);
    const dy = oz[first] * wx - ox[first] * wz - (oz[second] * wx - ox[second] * wz);
    const dz = ox[first] * wy - oy[first] * wx - (ox[second] * wy - oy[second] * wx);
    const closing = Math.max(-1, Math.min(1, (dx * tx + dy * ty + dz * tz) / tl));

    let height = base[first] + (base[second] - base[first]) * 0.5 * Math.exp(-edge / 0.07);
    const belt = Math.exp(-((edge / 0.075) ** 2));
    const narrow = Math.exp(-((edge / 0.03) ** 2));
    let uplift = 0;
    if (closing > 0) {
      if (land[first]) uplift = closing * belt;
      else if (land[second]) height -= closing * 0.22 * narrow;
      else uplift = closing * 0.55 * narrow;
    } else if (land[first] && land[second]) {
      height += closing * 0.25 * narrow;
    } else if (!land[first] && !land[second]) {
      height -= closing * 0.07 * Math.exp(-((edge / 0.045) ** 2));
    }

    const ridges = noise.ridged(px * 5.2 + 3.3, py * 5.2, pz * 5.2, 6);
    // Old ranges inside the continents, worn lower than the young belts.
    const inner = Math.max(0, noise.fbm(px * 1.3 + 7.1, py * 1.3, pz * 1.3, 3)) * (land[first] ? 1 : 0.15);
    height += t.mountains * (uplift * (0.28 + 0.75 * ridges) + inner * 0.55 * ridges);
    height += t.relief * 0.55 * noise.fbm(px * 2.3, py * 2.3 + 5.5, pz * 2.3, 10);

    for (const v of volcanoes) {
      const d = angle(px * v.x + py * v.y + pz * v.z) / v.radius;
      if (d >= 1) continue;
      // A broad shield with a pit at the summit.
      const shield = Math.pow(1 - d, 1.6);
      const pit = d < 0.12 ? (0.12 - d) * 2.2 : 0;
      height += v.height * (shield - pit) * (0.85 + 0.3 * ridges);
    }

    h[i] = height;
  }

  if (t.plains > 0) {
    // Lowlands fill with sediment or lava and become plains.
    const sorted = Float32Array.from(h).sort();
    const low = sorted[Math.floor(sorted.length * 0.35)];
    for (let i = 0; i < h.length; i++) {
      if (h[i] < low) h[i] = low + (h[i] - low) * (1 - t.plains);
    }
  }
  return h;
}

/**
 * Rain: each drop runs downhill, picks up ground where it is fast and drops it
 * where it slows. Thousands of them cut valleys and build plains.
 */
function erode(h: Float32Array, t: Terrain): void {
  const drops = Math.floor(W * H * t.rain);
  if (drops === 0) return;
  const rand = random(t.seed * 13 + 5);
  // The drops work on steeper ground than the stored heights, see `scale`.
  const scale = (W / 340) * t.carve;
  const inertia = 0.06;
  const capacity = 4;
  const minSlope = 0.01;
  const erodeSpeed = 0.3;
  const depositSpeed = 0.3;
  const evaporate = 0.015;
  const gravity = 4;
  const radius = 2;
  const brush: { dx: number; dy: number; w: number }[] = [];
  let weight = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      brush.push({ dx, dy, w: 1 - d / (radius + 0.5) });
      weight += 1 - d / (radius + 0.5);
    }
  }
  for (const b of brush) b.w /= weight;

  for (let n = 0; n < drops; n++) {
    // Spread evenly over the ball, not over the map.
    let y = (0.5 - Math.asin(rand() * 2 - 1) / Math.PI) * H - 0.5;
    let x = rand() * W;
    let dirX = 0;
    let dirY = 0;
    let speed = 1;
    let water = 1;
    let load = 0;
    for (let life = 0; life < 64; life++) {
      const yi = Math.floor(y);
      if (yi < 2 || yi >= H - 3) break;
      const xi = Math.floor(x);
      const fx = x - xi;
      const fy = y - yi;
      const x0 = ((xi % W) + W) % W;
      const x1 = (x0 + 1) % W;
      const i00 = yi * W + x0;
      const i10 = yi * W + x1;
      const i01 = i00 + W;
      const i11 = i10 + W;
      const h00 = h[i00] * scale;
      const h10 = h[i10] * scale;
      const h01 = h[i01] * scale;
      const h11 = h[i11] * scale;
      const shrink = COS[yi];
      const gx = ((h10 - h00) * (1 - fy) + (h11 - h01) * fy) / shrink;
      const gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
      dirX = dirX * inertia - gx * (1 - inertia);
      dirY = dirY * inertia - gy * (1 - inertia);
      const len = Math.hypot(dirX, dirY);
      if (len < 1e-9) break;
      dirX /= len;
      dirY /= len;
      const before = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
      x += dirX / shrink;
      y += dirY;
      const ny = Math.floor(y);
      if (ny < 2 || ny >= H - 3) break;
      const nxi = Math.floor(x);
      const nfx = x - nxi;
      const nfy = y - ny;
      const nx0 = ((nxi % W) + W) % W;
      const nx1 = (nx0 + 1) % W;
      const after =
        (h[ny * W + nx0] * (1 - nfx) * (1 - nfy) +
          h[ny * W + nx1] * nfx * (1 - nfy) +
          h[(ny + 1) * W + nx0] * (1 - nfx) * nfy +
          h[(ny + 1) * W + nx1] * nfx * nfy) *
        scale;
      const drop = after - before;
      const room = Math.max(-drop, minSlope) * speed * water * capacity;
      if (load > room || drop > 0) {
        const amount = (drop > 0 ? Math.min(drop, load) : (load - room) * depositSpeed) / scale;
        load -= amount * scale;
        h[i00] += amount * (1 - fx) * (1 - fy);
        h[i10] += amount * fx * (1 - fy);
        h[i01] += amount * (1 - fx) * fy;
        h[i11] += amount * fx * fy;
      } else {
        const amount = Math.min((room - load) * erodeSpeed, -drop) / scale;
        for (const b of brush) {
          const bx = (((x0 + b.dx) % W) + W) % W;
          h[(yi + b.dy) * W + bx] -= amount * b.w;
        }
        load += amount * scale;
      }
      speed = Math.sqrt(Math.max(0, speed * speed - drop * gravity));
      water *= 1 - evaporate;
    }
  }
}

/**
 * Takes the grain of single raindrops out of the heights. The light on slopes
 * would show it as a rough skin all over the land.
 */
function smooth(h: Float32Array): void {
  const copy = Float32Array.from(h);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 0; x < W; x++) {
      const l = (x + W - 1) % W;
      const r = (x + 1) % W;
      const up = (y - 1) * W;
      const mid = y * W;
      const down = (y + 1) * W;
      h[mid + x] =
        (copy[up + l] + copy[up + r] + copy[down + l] + copy[down + r] +
          2 * (copy[up + x] + copy[down + x] + copy[mid + l] + copy[mid + r]) +
          4 * copy[mid + x]) /
        16;
    }
  }
}

/** A heap of cell numbers, lowest height first. */
class Heap {
  private readonly cells: number[] = [];
  constructor(private readonly key: Float32Array) {}
  get size(): number {
    return this.cells.length;
  }
  push(cell: number): void {
    const cells = this.cells;
    const key = this.key;
    let i = cells.length;
    cells.push(cell);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (key[cells[parent]] <= key[cell]) break;
      cells[i] = cells[parent];
      i = parent;
    }
    cells[i] = cell;
  }
  pop(): number {
    const cells = this.cells;
    const key = this.key;
    const top = cells[0];
    const last = cells.pop() as number;
    const n = cells.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && key[cells[child + 1]] < key[cells[child]]) child++;
        if (key[cells[child]] >= key[last]) break;
        cells[i] = cells[child];
        i = child;
      }
      cells[i] = last;
    }
    return top;
  }
}

/**
 * Where water gathers: every cell hands its rain to a lower neighbour, from
 * the summits down to the deepest basins. Hollows are filled on the way, so
 * rivers run through to the sea. Returns 0 (ridge) to 1 (largest rivers).
 */
function rivers(h: Float32Array): Float32Array {
  const n = W * H;
  const filled = Float32Array.from(h);
  const towards = new Int32Array(n).fill(-1);
  const seen = new Uint8Array(n);
  const order = new Int32Array(n);
  const heap = new Heap(filled);

  // The deepest tenth is certainly sea or basin floor: water ends there.
  const sorted = Float32Array.from(h).sort();
  const floor = sorted[Math.floor(n * 0.1)];
  for (let i = 0; i < n; i++) {
    if (h[i] <= floor) {
      seen[i] = 1;
      heap.push(i);
    }
  }
  let count = 0;
  while (heap.size > 0) {
    const cell = heap.pop();
    order[count++] = cell;
    const cy = Math.floor(cell / W);
    const cxx = cell - cy * W;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const neighbour = ny * W + ((cxx + dx + W) % W);
        if (seen[neighbour]) continue;
        seen[neighbour] = 1;
        if (filled[neighbour] <= filled[cell]) filled[neighbour] = filled[cell] + 1e-6;
        towards[neighbour] = cell;
        heap.push(neighbour);
      }
    }
  }

  const water = new Float32Array(n);
  for (let y = 0; y < H; y++) water.fill(COS[y], y * W, (y + 1) * W);
  for (let k = count - 1; k >= 0; k--) {
    const cell = order[k];
    if (towards[cell] >= 0) water[towards[cell]] += water[cell];
  }

  const out = new Float32Array(n);
  const top = Math.log(1 + n * 0.004);
  for (let i = 0; i < n; i++) {
    // Filled hollows are lakes or level plains. Water crosses them without a
    // bed of its own, and drawing its path there would hatch them with lines.
    const level = filled[i] !== h[i];
    // Only real valleys and rivers are kept, from where a fair stretch of
    // land drains together. The trickle on every slope would only be noise.
    const amount = Math.min(1, Math.log(1 + water[i]) / top);
    out[i] = h[i] <= floor || level ? 0 : Math.max(0, (amount - 0.45) / 0.55);
  }
  return widen(out);
}

/**
 * Lets fine lines keep some strength when the map is seen from afar, and
 * rounds them off: a line one pixel wide runs in steps, which show as soon as
 * the viewer comes close.
 */
function widen(lines: Float32Array): Float32Array {
  const wide = new Float32Array(lines.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let around = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = Math.min(H - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          // Less across a corner than across an edge, so the line grows round.
          const reach = dx !== 0 && dy !== 0 ? 0.6 : 0.82;
          around = Math.max(around, lines[ny * W + ((x + dx + W) % W)] * reach);
        }
      }
      wide[y * W + x] = Math.max(lines[y * W + x], around);
    }
  }
  const out = new Float32Array(lines.length);
  for (let y = 0; y < H; y++) {
    const up = Math.max(0, y - 1) * W;
    const mid = y * W;
    const down = Math.min(H - 1, y + 1) * W;
    for (let x = 0; x < W; x++) {
      const l = (x + W - 1) % W;
      const r = (x + 1) % W;
      out[mid + x] =
        (wide[up + l] + wide[up + r] + wide[down + l] + wide[down + r] +
          2 * (wide[up + x] + wide[down + x] + wide[mid + l] + wide[mid + r]) +
          4 * wide[mid + x]) /
        16;
    }
  }
  return out;
}

/** Long cracks in a crust of ice: arcs of great circles, some of them doubled. */
function cracks(t: Terrain, h: Float32Array): Float32Array {
  const rand = random(t.seed * 17 + 3);
  const out = new Float32Array(W * H);
  for (let c = 0; c < t.cracks; c++) {
    // A great circle is all points at right angles to its pole.
    const [nx, ny, nz] = randomDirection(rand);
    let [ux, uy, uz] = randomDirection(rand);
    const d = ux * nx + uy * ny + uz * nz;
    ux -= nx * d;
    uy -= ny * d;
    uz -= nz * d;
    const ul = Math.hypot(ux, uy, uz);
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = ny * uz - nz * uy;
    const vy = nz * ux - nx * uz;
    const vz = nx * uy - ny * ux;
    const length = 0.3 + 2.4 * Math.pow(rand(), 1.8);
    const strength = 0.35 + 0.65 * Math.pow(rand(), 1.5);
    const width = (0.6 + 1.6 * rand() * strength) * (W / 2048);
    const bend = (rand() - 0.5) * 0.25;
    const steps = Math.ceil((length * W) / Math.PI);
    for (let s = 0; s <= steps; s++) {
      const a = (s / steps) * length;
      // A slight bend keeps the cracks from looking ruled.
      const off = bend * Math.sin((s / steps) * Math.PI);
      let x = Math.cos(a) * ux + Math.sin(a) * vx + off * nx;
      let y = Math.cos(a) * uy + Math.sin(a) * vy + off * ny;
      let z = Math.cos(a) * uz + Math.sin(a) * vz + off * nz;
      const l = Math.hypot(x, y, z);
      x /= l;
      y /= l;
      z /= l;
      const [fx, fy] = toPixel(x, y, z);
      const row = Math.round(fy);
      if (row < 1 || row >= H - 1) continue;
      const fade = Math.sin((s / steps) * Math.PI) ** 0.4 * strength * smoothstep(0.985, 0.93, Math.abs(y));
      const reach = Math.ceil(width * 2);
      const stretch = 1 / COS[row];
      for (let dy = -reach; dy <= reach; dy++) {
        const yy = row + dy;
        if (yy < 0 || yy >= H) continue;
        const reachX = Math.ceil(reach * stretch);
        for (let dx = -reachX; dx <= reachX; dx++) {
          const dist = Math.hypot(dx / stretch, dy) / width;
          if (dist > 2) continue;
          const xx = (((Math.round(fx) + dx) % W) + W) % W;
          const value = fade * Math.exp(-dist * dist * 1.5);
          const i = yy * W + xx;
          if (value > out[i]) out[i] = value;
        }
      }
    }
  }
  // The ice is pushed up a little along its cracks.
  for (let i = 0; i < out.length; i++) h[i] += out[i] * 0.03;
  return out;
}

/**
 * Impacts: a bowl, a raised rim and a blanket of thrown-out ground. Young
 * craters wipe out what lay below them. Returns the change in height.
 */
function craters(t: Terrain): Float32Array {
  const rand = random(t.seed * 19 + 7);
  const out = new Float32Array(W * H);
  const smallest = (1.6 * Math.PI) / H;
  for (let c = 0; c < t.craters; c++) {
    const [x, y, z] = randomDirection(rand);
    // Many small ones, few large ones.
    const radius = smallest / Math.pow(1 - rand() * (1 - (smallest / t.craterMax) ** 2), 0.5);
    // Small craters are shallow, large ones deep. The giant basins are
    // shallow for their width again: their floors rose and their rims sank.
    const depth = (0.25 + 0.75 * Math.min(1, radius / 0.06)) * Math.min(1, 0.16 / radius);
    const age = rand();
    const [fx, fy] = toPixel(x, y, z);
    const reach = radius * 2.2;
    const rows = Math.ceil((reach / Math.PI) * H);
    for (let dy = -rows; dy <= rows; dy++) {
      const yy = Math.round(fy) + dy;
      if (yy < 0 || yy >= H) continue;
      const cols = Math.min(W / 2, Math.ceil(((reach / (2 * Math.PI)) * W) / COS[yy]));
      for (let dx = -cols; dx <= cols; dx++) {
        const xx = (((Math.round(fx) + dx) % W) + W) % W;
        const i = yy * W + xx;
        const d = angle(PX[i] * x + PY[i] * y + PZ[i] * z) / radius;
        if (d > 2.2) continue;
        // Old craters are worn: shallower bowls and softer rims.
        const worn = 0.45 + 0.55 * age;
        const bowl = d < 1 ? (d * d - 1) * depth * worn : 0;
        const rim = Math.exp(-(((d - 1) / 0.14) ** 2)) * 0.32 * depth * worn;
        const thrown = d > 1 ? Math.exp(-(d - 1) / 0.35) * 0.1 * depth * worn : 0;
        const wipe = smoothstep(1.15, 0.85, d) * 0.85;
        out[i] = out[i] * (1 - wipe) + bowl + rim + thrown;
      }
    }
  }
  return out;
}

// ---- Gas giants ----------------------------------------------------------------

interface Bands {
  name: string;
  seed: number;
  /** Number of jets between the poles and how fast they blow. */
  jets: number;
  wind: number;
  /** Strength of the jet at the equator: Saturn has a broad fast one. */
  equator: number;
  /** Counts of large ovals and of smaller whirls that last, and how hard they turn. */
  ovals: number;
  eddies: number;
  spin: number;
  /** Strength of the turbulence between the jets, and how fine it is (swirls around the planet's girth). */
  turbulence: number;
  grain: number;
  /** How finely the belts are divided. */
  belts: number;
  /** How long the simulation runs: longer draws the clouds out further. */
  time: number;
}

/** Strength of the alternating jets, where the jet at the equator of a preset with `equator: 1` has the strength 1. */
const JET_STRENGTH = 0.75;
/** How narrow the jet at the equator is. */
const EQUATOR_NARROWNESS = 7;

/** The winds of a band preset as the shader reads them (GlobeSpec.jets and belts in globe/spec.ts). */
interface Winds {
  strength: number;
  count: number;
  equator: number;
  narrowness: number;
  phase: number;
}

/**
 * The winds a band preset is simulated with, for the shader: it lets them
 * blow on, so the clouds drift the way they were drawn out. Only their shape
 * counts there, so the fastest latitude gets a speed of about 1.
 */
function winds(b: Bands, phase: number): Winds {
  const fastest = JET_STRENGTH + Math.abs(b.equator);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    strength: round(JET_STRENGTH / fastest),
    count: b.jets,
    equator: round(b.equator / fastest),
    narrowness: EQUATOR_NARROWNESS,
    phase: round(phase),
  };
}

const BANDS: Bands[] = [
  // Like Jupiter: many belts, strong winds, lively turbulence and one great oval.
  { name: "bands-stormy", seed: 101, jets: 19, wind: 1, equator: 0.5, ovals: 3, eddies: 14, spin: 1, turbulence: 1, grain: 9, belts: 14, time: 1 },
  // Like Saturn: broad soft belts, a fast equator, few storms.
  { name: "bands-broad", seed: 113, jets: 11, wind: 0.9, equator: 1.3, ovals: 1, eddies: 6, spin: 0.7, turbulence: 0.55, grain: 7, belts: 9, time: 1.25 },
  // Like Uranus and Neptune: hardly any belts, a few dark spots and bright streaks.
  { name: "bands-calm", seed: 127, jets: 5, wind: 0.7, equator: -0.9, ovals: 2, eddies: 4, spin: 0.8, turbulence: 0.3, grain: 6, belts: 4.5, time: 1.4 },
  // Many thin belts, finely ruffled, with a string of small ovals.
  { name: "bands-fine", seed: 139, jets: 29, wind: 0.85, equator: 0.7, ovals: 2, eddies: 22, spin: 0.9, turbulence: 0.7, grain: 13, belts: 22, time: 1.1 },
  // A restless giant: the belts are torn into festoons and plumes.
  { name: "bands-wild", seed: 151, jets: 13, wind: 1, equator: 0.3, ovals: 4, eddies: 20, spin: 1.1, turbulence: 1.7, grain: 7, belts: 10, time: 0.9 },
  // Under a deck of haze: faint broad belts, nothing sharp.
  { name: "bands-hazy", seed: 163, jets: 7, wind: 0.6, equator: 0.8, ovals: 0, eddies: 0, spin: 0.6, turbulence: 0.4, grain: 5, belts: 3.5, time: 1.5 },
];

/**
 * Lets coloured gas flow in a wind field and records where it ends up. For
 * every pixel the path of the gas is followed backwards in time, which keeps
 * the finest threads sharp, where a grid of dye would blur them. Returns the
 * picture and where along the latitudes the alternating jets begin.
 *
 * Three winds blow at once: the jets along the latitudes, a few whirls that
 * last (the ovals), and turbulence that keeps changing while the gas flows.
 * In a flow that stands still, gas winds up into neat spirals, which look
 * drawn. In one that changes, it is stretched and folded into the festoons
 * and ragged plumes of a real giant.
 */
function buildBands(b: Bands): { pixels: Uint8Array; phase: number } {
  const rand = random(b.seed);
  const noise = new Noise(b.seed * 3 + 1);

  // Wind along the latitudes, by row. Positive blows east.
  const jet = new Float32Array(H);
  const phase = rand() * 6.28;
  for (let y = 0; y < H; y++) {
    const s = Math.sin((0.5 - (y + 0.5) / H) * Math.PI);
    const calm = 1 - Math.pow(Math.abs(s), 6);
    jet[y] =
      (Math.sin(s * b.jets + phase) * JET_STRENGTH + b.equator * Math.exp(-s * s * EQUATOR_NARROWNESS)) *
      calm *
      b.wind;
  }

  // Everything but the jets is a stream function on a coarser grid: gas flows
  // along its contour lines, so nothing piles up or thins out.
  const GW = 1024;
  const GH = 512;
  const steady = new Float32Array(GW * GH);
  const storms = new Float32Array(GW * GH);
  const whirl = (size: number, turns: number, marks: boolean) => {
    // Whirls sit where the wind changes fastest and roll with it.
    let row = 0;
    let shear = 0;
    for (let tries = 0; tries < 3; tries++) {
      const y = Math.floor(H * (0.12 + 0.76 * rand()));
      const s = jet[Math.min(H - 1, y + 3)] - jet[Math.max(0, y - 3)];
      if (Math.abs(s) > Math.abs(shear)) {
        shear = s;
        row = y;
      }
    }
    const gx = rand() * GW;
    const gy = (row / H) * GH;
    const sx = size * 1.7;
    const sy = size;
    // This strength turns the centre `turns` times during the simulation.
    const strength = turns * 2 * Math.PI * sx * sy * Math.sign(shear || 1);
    const reachX = Math.ceil(sx * 3.2);
    const reachY = Math.ceil(sy * 3.2);
    for (let dy = -reachY; dy <= reachY; dy++) {
      const yy = Math.round(gy) + dy;
      if (yy < 0 || yy >= GH) continue;
      for (let dx = -reachX; dx <= reachX; dx++) {
        const xx = (((Math.round(gx) + dx) % GW) + GW) % GW;
        const r2 = (dx / sx) ** 2 + (dy / sy) ** 2;
        // Down to exactly nothing at the edge: a step there would show as a scratch.
        if (r2 >= 9) continue;
        steady[yy * GW + xx] += strength * (Math.exp(-r2 * 0.5) - Math.exp(-4.5)) * (1 - r2 / 9);
        if (marks) storms[yy * GW + xx] = Math.max(storms[yy * GW + xx], Math.exp(-r2 * 0.9));
      }
    }
  };
  for (let i = 0; i < b.ovals; i++) whirl(9 + 9 * rand(), 0.8 * b.spin, true);
  for (let i = 0; i < b.eddies; i++) whirl(3 + 4 * rand(), 0.5 * b.spin, rand() < 0.5);

  // The turbulence at a few moments of the simulation; in between it is
  // blended. It is strongest where neighbouring jets rub against each other.
  const MOMENTS = 7;
  const rub = new Float32Array(GH);
  let strongest = 1e-6;
  for (let y = 0; y < GH; y++) {
    const row = Math.floor(((y + 0.5) / GH) * H);
    rub[y] = Math.abs(jet[Math.min(H - 1, row + 4)] - jet[Math.max(0, row - 4)]);
    strongest = Math.max(strongest, rub[y]);
  }
  // A swirl is this many cells of the grid wide. The turbulence carries the
  // gas a fraction of that width: enough to fold the edges of the belts into
  // festoons, not enough to stir the belts away.
  const swirl = GW / (2 * Math.PI) / b.grain;
  const push = (b.turbulence * 0.35 * swirl * swirl) / 0.25;
  const eu: Float32Array[] = [];
  const ev: Float32Array[] = [];
  const psi = new Float32Array(GW * GH);
  for (let m = 0; m < MOMENTS; m++) {
    // Moving through the noise lets the swirls drift, grow and fade.
    const age = (m / (MOMENTS - 1)) * 0.45;
    for (let y = 0; y < GH; y++) {
      const lat = (0.5 - (y + 0.5) / GH) * Math.PI;
      const s = Math.sin(lat);
      const c = Math.cos(lat);
      const here = push * (0.3 + 0.7 * (rub[y] / strongest)) * (1 - Math.pow(Math.abs(s), 6));
      for (let x = 0; x < GW; x++) {
        const lon = ((x + 0.5) / GW - 0.5) * 2 * Math.PI;
        // Drawn out along the latitudes, as the jets draw out everything.
        const turbulent = noise.fbm(
          c * Math.sin(lon) * b.grain * 0.6 + age * 1.3,
          s * b.grain + 31.4 - age * 0.7,
          c * Math.cos(lon) * b.grain * 0.6 + age,
          3,
        );
        psi[y * GW + x] = steady[y * GW + x] + here * turbulent;
      }
    }
    const u = new Float32Array(GW * GH);
    const v = new Float32Array(GW * GH);
    for (let y = 1; y < GH - 1; y++) {
      for (let x = 0; x < GW; x++) {
        const i = y * GW + x;
        u[i] = -(psi[i + GW] - psi[i - GW]) / 2;
        v[i] = (psi[y * GW + ((x + 1) % GW)] - psi[y * GW + ((x + GW - 1) % GW)]) / 2;
      }
    }
    eu.push(u);
    ev.push(v);
  }

  const STEPS = 72;
  const dt = 1 / STEPS;
  // How far the jets drag the gas along, in cells of the coarse grid.
  const SHEAR = 26 * b.time;
  const sx = GW / W;
  const sy = GH / H;
  const out = new Uint8Array(W * H * 3);

  // The wind of the whirls and the turbulence at a place and a moment.
  let windU = 0;
  let windV = 0;
  const wind = (x: number, y: number, moment: number) => {
    const m0 = Math.min(MOMENTS - 2, Math.floor(moment));
    const fm = moment - m0;
    const yc = Math.min(GH - 1.001, Math.max(0, y));
    const yi = Math.floor(yc);
    const fy = yc - yi;
    const xi = Math.floor(x);
    const fx = x - xi;
    const x0 = ((xi % GW) + GW) % GW;
    const i00 = yi * GW + x0;
    const i10 = yi * GW + ((x0 + 1) % GW);
    const i01 = i00 + GW;
    const i11 = i10 + GW;
    const w00 = (1 - fx) * (1 - fy);
    const w10 = fx * (1 - fy);
    const w01 = (1 - fx) * fy;
    const w11 = fx * fy;
    const u0 = eu[m0];
    const u1 = eu[m0 + 1];
    const v0 = ev[m0];
    const v1 = ev[m0 + 1];
    windU =
      (u0[i00] * w00 + u0[i10] * w10 + u0[i01] * w01 + u0[i11] * w11) * (1 - fm) +
      (u1[i00] * w00 + u1[i10] * w10 + u1[i01] * w01 + u1[i11] * w11) * fm;
    windV =
      (v0[i00] * w00 + v0[i10] * w10 + v0[i01] * w01 + v0[i11] * w11) * (1 - fm) +
      (v1[i00] * w00 + v1[i10] * w10 + v1[i01] * w01 + v1[i11] * w11) * fm;
  };

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      let x = px * sx;
      let y = py * sy;
      // Backwards in time, from the picture to where the gas came from, with
      // a half step for accuracy.
      for (let step = 0; step < STEPS; step++) {
        const moment = (1 - (step + 0.5) / STEPS) * (MOMENTS - 1);
        wind(x, y, moment);
        wind(x - windU * dt * 0.5, y - windV * dt * 0.5, moment);
        const row = Math.min(H - 1, Math.max(0, Math.round(y / sy)));
        x -= (windU + jet[row] * SHEAR) * dt;
        y = Math.min(GH - 1, Math.max(0, y - windV * dt));
      }

      // The gas as it was at the start: belts by latitude and fine streaks.
      const lat = (0.5 - (y + 0.5) / GH) * Math.PI;
      const lon = (x / GW - 0.5) * 2 * Math.PI;
      const s = Math.sin(lat);
      const c = Math.cos(lat);
      const ox = c * Math.sin(lon);
      const oz = c * Math.cos(lon);
      const ruffle = noise.fbm(ox * 3.1, s * 3.1, oz * 3.1, 4);
      const fine = noise.fbm(ox * 2.6 + 9.1, s * 44, oz * 2.6, 5);
      const belt = noise.fbm(7.7, (s + ruffle * 0.035) * b.belts, 3.3, 4) * 2.4 + fine * 0.55;
      const streak = noise.fbm(ox * 4.2 + 40, s * 23, oz * 4.2, 5);

      const here = py * W + px;
      const gi = Math.min(GH - 1, Math.floor(py * sy)) * GW + Math.min(GW - 1, Math.floor(px * sx));
      out[here * 3] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + belt * 0.62)));
      out[here * 3 + 1] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + streak * 1.1)));
      out[here * 3 + 2] = Math.round(255 * Math.min(1, storms[gi]));
    }
  }
  return { pixels: out, phase };
}

// ---- Output ------------------------------------------------------------------

async function save(name: string, pixels: Uint8Array, separate: boolean): Promise<void> {
  const image = () => sharp(pixels, { raw: { width: W, height: H, channels: 3 } });
  // Ordinary lossy pictures store brightness and colour, which mixes the
  // three channels: rivers would leak into the heights and show as dotted
  // ground. Terrain is therefore stored "near lossless", which keeps the
  // channels apart. The bands of gas giants do not mind the mixing.
  const format = separate
    ? ({ nearLossless: true, quality: 20, effort: 6 } as const)
    : ({ quality: 84, smartSubsample: true, effort: 6 } as const);
  // Large for the 3D model, small for the images in lists.
  await image()
    .resize(2048, 1024, { kernel: "cubic" })
    .webp(format)
    .toFile(path.join(OUT, `${name}-lg.webp`));
  await image()
    .resize(512, 256)
    .webp(format)
    .toFile(path.join(OUT, `${name}-sm.webp`));
}

/** Heights below which each twentieth of the surface lies, for choosing a sea level. */
function levels(height: Uint8Array): number[] {
  const histogram = new Float64Array(256);
  let total = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      histogram[height[y * W + x]] += COS[y];
      total += COS[y];
    }
  }
  const out: number[] = [];
  let sum = 0;
  let value = 0;
  for (let step = 0; step <= 20; step++) {
    const target = (total * step) / 20;
    while (value < 255 && sum + histogram[value] < target) sum += histogram[value++];
    out.push(Math.round((value / 255) * 1000) / 1000);
  }
  return out;
}

/** What presets.json holds. */
interface Meta {
  terrain: Record<string, { levels: number[] }>;
  bands: Record<string, Winds>;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  // A run that only simulates one kind keeps what is known of the other.
  const known = await readFile(META, "utf8").then(
    (text) => JSON.parse(text) as Partial<Meta>,
    () => ({}) as Partial<Meta>,
  );
  const meta: Meta = {
    terrain: (KIND === "bands" && known.terrain) || {},
    bands: (KIND === "terrain" && known.bands) || {},
  };

  for (const t of TERRAINS) {
    if (KIND === "bands" || (ONLY && !ONLY.includes(t.name))) continue;
    const started = Date.now();
    const h = buildTerrain(t);
    erode(h, t);
    if (t.rain > 0) smooth(h);
    // Without rain there are no rivers: the green channel stays empty.
    const lines =
      t.cracks > 0 ? cracks(t, h) : t.rain > 0 ? rivers(h) : new Float32Array(W * H);
    const dents = craters(t);

    // The heights fill the whole range of a byte, without the rare extremes.
    const sorted = Float32Array.from(h).sort();
    const low = sorted[Math.floor(sorted.length * 0.002)];
    const high = sorted[Math.floor(sorted.length * 0.998)];
    const pixels = new Uint8Array(W * H * 3);
    const heights = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const value = Math.round(255 * Math.min(1, Math.max(0, (h[i] - low) / (high - low))));
      heights[i] = value;
      pixels[i * 3] = value;
      pixels[i * 3 + 1] = Math.round(255 * Math.min(1, Math.max(0, lines[i])));
      pixels[i * 3 + 2] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + dents[i] * 0.5)));
    }
    await save(t.name, pixels, true);
    meta.terrain[t.name] = { levels: levels(heights) };
    console.log(`${t.name}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }

  for (const b of BANDS) {
    if (KIND === "terrain" || (ONLY && !ONLY.includes(b.name))) continue;
    const started = Date.now();
    const { pixels, phase } = buildBands(b);
    await save(b.name, pixels, false);
    meta.bands[b.name] = winds(b, phase);
    console.log(`${b.name}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }

  // A trial run of some presets leaves the file as it is.
  if (!ONLY) await writeFile(META, `${JSON.stringify(meta, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
