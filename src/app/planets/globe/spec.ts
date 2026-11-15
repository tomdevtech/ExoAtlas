/**
 * Everything the moving image and the 3D model need to know to draw a planet.
 * Plain data, so the server can compute it and hand it to the browser.
 */
export interface GlobeSpec {
  /**
   * `solid`: computed terrain. `gas`: computed bands. `map`: a real map of the
   * surface, which only the planets of the solar system have.
   */
  kind: "solid" | "gas" | "map";
  /** Seed of the computed pattern. Same planet, same surface. */
  seed: number;
  /**
   * Solid: low ground, middle ground, high ground. Gas: dark belts, base
   * colour, bright zones.
   */
  palette: [string, string, string];
  /** `level` is the height below which there is water, roughly -0.3 to 0.3. */
  ocean: { color: string; level: number } | null;
  /** Size of the polar caps: 0 for none, 1 for ice down to the equator. */
  ice: number;
  /** `cover` is the share of the sky with clouds, 0 to 1. */
  clouds: { color: string; cover: number } | null;
  /** Light the planet gives off itself: lava on solid planets, heat on gas giants. */
  glow: { color: string; strength: number } | null;
  /** Amount of craters, 0 to 1. Only on solid planets. */
  craters: number;
  /** How strongly heights catch the light, 0 for a smooth ball. */
  relief: number;
  /** Only for gas: how much the bands stand out, how wavy they are, how likely storms are. */
  bands: { contrast: number; turbulence: number; storms: number };
  /** `density` from 0 (none) to 1 (thick like on Earth or Venus). */
  atmosphere: { color: string; density: number } | null;
  /** Colour of the starlight. */
  light: string;
  /** Inner and outer edge in planet radii. `map` names a texture of the rings. */
  rings: { inner: number; outer: number; map: string | null } | null;
  /** Tilt of the axis in degrees. */
  tiltDeg: number;
  /** Direction and speed of the rotation: 1 is the usual pace, negative turns backwards. */
  spin: number;
  /** Names of the textures in public/textures/planets. */
  maps: { day: string; night: string | null; clouds: string | null } | null;
}

/** Share of the picture's half width the planet fills. Ringed planets leave room for the rings. */
export function globeRadius(spec: GlobeSpec): number {
  return spec.rings ? 0.84 / spec.rings.outer : 0.84;
}

/** "#rrggbb" to red, green and blue as linear light from 0 to 1, as the shader calculates with it. */
export function linearColor(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) => (((value >> shift) & 0xff) / 255) ** 2.2;
  return [channel(16), channel(8), channel(0)];
}

/** Three offsets into the noise, derived from the seed. */
export function seedOffset(seed: number): [number, number, number] {
  return [(seed * 0.731) % 97, (seed * 1.379) % 89, (seed * 2.113) % 83];
}

/**
 * A rotation as nine numbers, row by row. It turns the planet's own
 * coordinates (y is the axis) into those of the viewer (x right, y up, z
 * towards the viewer).
 *
 * The planet spins around its axis, the axis is tilted, and the viewer may
 * have turned the camera by `yaw` and `pitch`.
 */
export function globeRotation(
  spec: GlobeSpec,
  seconds: number,
  yaw = 0,
  pitch = 0,
): number[] {
  const phase = ((spec.seed * 0.618) % 1) * Math.PI * 2;
  const spin = rotationY(phase + seconds * SPIN_RATE * spec.spin);
  const tilt = rotationZ((-spec.tiltDeg * Math.PI) / 180);
  // The north pole leans a little towards the viewer, so the rings open up.
  const lean = rotationX(LEAN);
  const camera = multiply(rotationX(pitch), rotationY(yaw));
  return multiply(camera, multiply(lean, multiply(tilt, spin)));
}

/** Direction to the star as the viewer sees it: from the upper left, slightly from the front. */
export function lightDirection(yaw = 0, pitch = 0): [number, number, number] {
  const camera = multiply(rotationX(pitch), rotationY(yaw));
  const [x, y, z] = LIGHT;
  return [
    camera[0] * x + camera[1] * y + camera[2] * z,
    camera[3] * x + camera[4] * y + camera[5] * z,
    camera[6] * x + camera[7] * y + camera[8] * z,
  ];
}

/** One turn takes about 40 seconds. */
const SPIN_RATE = (Math.PI * 2) / 40;
const LEAN = 0.24;
const LIGHT = normalize([-0.62, 0.42, 0.66]);

function normalize([x, y, z]: number[]): [number, number, number] {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

function rotationX(angle: number): number[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

function rotationY(angle: number): number[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

function rotationZ(angle: number): number[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[row * 3 + col] =
        a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col];
    }
  }
  return out;
}
