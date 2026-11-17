/** A rotation or mirroring as nine numbers, column by column, as the shader reads a matrix. */
export type Turn = [number, number, number, number, number, number, number, number, number];

/** The turn that leaves everything where it is. */
export const NO_TURN: Turn = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Everything the moving image and the 3D model need to know to draw a planet.
 * Plain data, so the server can compute it and hand it to the browser.
 */
export interface GlobeSpec {
  /**
   * `terrain` and `bands`: a simulated base map (preset) for rocky planets and
   * gas giants, which the values of the planet turn into its own picture.
   * `map`: a real map of the surface, which only the planets of the solar
   * system have.
   */
  kind: "map" | "terrain" | "bands";
  /** Seed of the computed parts: clouds, fine grain, the bend of the coasts. Same planet, same surface. */
  seed: number;
  /**
   * Rocky planets: low ground, middle ground, high ground. Gas planets: dark
   * belts, base colour, bright zones.
   */
  palette: [string, string, string];
  /**
   * `level` is the height of the preset (0 to 1) below which there is water.
   * A `map` shows its own seas and only needs to know that it has some.
   */
  ocean: { color: string; level: number } | null;
  /** Size of the polar caps: 0 for none, 1 for ice down to the equator. */
  ice: number;
  /** `cover` is the share of the sky with clouds, 0 to 1. */
  clouds: { color: string; cover: number } | null;
  /** Light the planet gives off itself: lava on solid planets, heat on gas giants. */
  glow: { color: string; strength: number } | null;
  /** Polar lights: rings of light around the magnetic poles on the night side. */
  aurora: { color: string; strength: number } | null;
  /** How often lightning flashes in the storms of a gas planet at night, 0 for never. */
  lightning: number;
  /**
   * How lively the storms are, each 0 (none) to 1: cyclones over the sea of
   * a rocky planet, dust storms on a dry one with air, the turning of the
   * storms of a gas planet, and bright outbreaks of fresh cloud on it.
   */
  storms: { cyclones: number; dust: number; spin: number; outbreaks: number };
  /**
   * Only for `bands`: the largest storms of the preset (see presets.json), so
   * that they can turn: longitude and latitude in radians, half height in
   * radians of latitude, and 1 or -1 for the way they turn.
   */
  giantStorms: [number, number, number, number][];
  /** How deep the craters of a terrain preset show, 0 to 1. */
  craters: number;
  /** How strongly heights catch the light, 0 for a smooth ball. */
  relief: number;
  /** Only for `bands`: how much the belts stand out, and how strongly the fine streaks and the storms show. */
  bands: { contrast: number; turbulence: number; storms: number };
  /** `density` from 0 (none) to 1 (thick like on Earth or Venus). */
  atmosphere: { color: string; density: number } | null;
  /** Colour of the starlight. */
  light: string;
  /** Inner and outer edge in planet radii. `map` names a texture of the rings. */
  rings: { inner: number; outer: number; map: string | null } | null;
  /**
   * A moon on a round orbit above the equator: its radius and the radius of
   * its orbit in planet radii, the seconds one orbit takes on the screen, and
   * where on the orbit it starts, in radians.
   */
  moon: { size: number; distance: number; period: number; phase: number } | null;
  /** How much shorter the planet is from pole to pole than across: 0 for a ball, 0.1 for Saturn. */
  flattening: number;
  /**
   * How sharply the climate is split into zones by latitude: 1 for an upright
   * axis, less the more the axis is tilted and the seasons mix the zones.
   */
  zones: number;
  /**
   * 1 for a planet that always turns the same side to its star, 0 for one
   * with days and nights. On such a planet the climate does not follow the
   * latitude: it runs from the point under the star to the night side.
   */
  locked: number;
  /** Tilt of the axis in degrees. */
  tiltDeg: number;
  /** Direction and speed of the rotation: 1 is the usual pace, negative turns backwards. */
  spin: number;
  /** How the clouds flow: 0 not at all, 1 bands drifting against each other (gas giants), 2 one cloud deck that lags towards the poles (Venus). */
  flow: number;
  /**
   * Winds of the bands for flow 1: strength and number of the alternating
   * jets, strength (negative: backwards) and narrowness of the jet at the
   * equator. For `bands` these are the winds the preset was simulated with.
   */
  jets: [number, number, number, number];
  /**
   * How the planet lays its preset on the ball. A `terrain` may be turned any
   * way and mirrored; `bands` only turn about the axis and swap east and west
   * or north and south, as their belts have to follow the latitudes.
   */
  turn: Turn;
  /**
   * A second `terrain` preset, turned its own way. The two are mixed in
   * large patches, so that hardly two planets share a face.
   */
  second: { map: string; turn: Turn } | null;
  /**
   * What a rocky planet makes of its `terrain` preset: height (0 to 1) up to
   * which lava or old dry basins reach (0 for none), strength of the rivers,
   * height of the relief, 1 for a crust of ice.
   */
  terrain: [number, number, number, number];
  /**
   * What a gas planet makes of its `bands` preset: the share of the latitudes
   * of the preset that is shown, and the phase of its jets (see `jets`).
   */
  belts: [number, number];
  /**
   * Names of the textures: in public/textures/planets for `map`, the preset
   * in public/textures/presets (as `day`) for `terrain` and `bands`.
   */
  maps: { day: string; night: string | null; clouds: string | null };
}

/** Share of the picture's half width the planet fills. Rings and a moon need room around it. */
export function globeRadius(spec: GlobeSpec): number {
  const reach = Math.max(
    1,
    spec.rings?.outer ?? 0,
    spec.moon ? spec.moon.distance + spec.moon.size : 0,
  );
  return 0.84 / reach;
}

/**
 * A rocky planet that always shows its star the same side cannot turn in
 * front of the viewer. Instead the viewer swings slowly to and fro around it,
 * which moves the edge of the night across the picture. A gas planet needs
 * none of this: its winds carry the clouds around it all the same. Returns
 * the angle to add to the viewer's own, in radians.
 */
export function lockedSway(spec: GlobeSpec, seconds: number): number {
  if (spec.kind !== "terrain") return 0;
  return spec.locked * 0.85 * Math.sin(seconds * SPIN_RATE * 0.5);
}

/**
 * Where the moon is, as the viewer sees it, in planet radii: x right, y up, z
 * towards the viewer. Its orbit lies above the equator of the planet.
 */
export function moonPosition(
  spec: GlobeSpec,
  seconds: number,
  yaw = 0,
  pitch = 0,
): [number, number, number] | null {
  if (!spec.moon) return null;
  const angle = spec.moon.phase + (seconds / spec.moon.period) * 2 * Math.PI;
  const x = Math.cos(angle) * spec.moon.distance;
  const z = Math.sin(angle) * spec.moon.distance;
  const frame = axisFrame(spec, yaw, pitch);
  return [frame[0] * x + frame[2] * z, frame[3] * x + frame[5] * z, frame[6] * x + frame[8] * z];
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
  return multiply(axisFrame(spec, yaw, pitch), spin);
}

/** The same without the spin: where the axis and the equator of the planet are. */
function axisFrame(spec: GlobeSpec, yaw: number, pitch: number): number[] {
  const tilt = rotationZ((-spec.tiltDeg * Math.PI) / 180);
  // The north pole leans a little towards the viewer, so the rings open up.
  const lean = rotationX(LEAN);
  const camera = multiply(rotationX(pitch), rotationY(yaw));
  return multiply(camera, multiply(lean, tilt));
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
