import {
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DoubleSide,
  GLSL3,
  Group,
  Mesh,
  OneFactor,
  PlaneGeometry,
  Points,
  RawShaderMaterial,
  type Camera,
} from "three";
import { clusterStars, globularSystem, LANDMARKS, type Landmark, type LandmarkKind } from "../landmarks";
import {
  cellKey,
  cellsAround,
  cellSize,
  cellStars,
  planFromPicture,
  reachAt,
  SMOOTH_PLAN,
  STAR_CLASSES,
  type CellStars,
  type Plan,
} from "../starfield";
import { FIELD_FRAGMENT, FIELD_VERTEX, LANDMARK_FRAGMENT, LANDMARK_VERTEX } from "./shaders";

/** Milliseconds per frame the stars of new cells may take, so flying stays smooth. */
const BUDGET_MS = 3;
/** How far a landmark gets its name, compared with its size, and at least. */
const NAMED_WITHIN = 40;
const NAMED_AT_LEAST = 120;

const additive = { blending: CustomBlending, blendSrc: OneFactor, blendDst: OneFactor } as const;

/** The kinds of landmark in the order LANDMARK_FRAGMENT numbers them. */
const LANDMARK_KINDS: readonly LandmarkKind[] = ["nebula", "cluster", "globular", "planetary", "remnant", "galaxy"];
/** How far the glow of a landmark reaches, in its radii: the faint outskirts lie far beyond the bright middle. */
const GLOW_SIZE: Record<LandmarkKind, number> = {
  nebula: 3.2,
  cluster: 3,
  globular: 3,
  planetary: 1.6,
  remnant: 1.4,
  galaxy: 1.5,
};
/** Beyond this distance no landmark is named, however large. */
const NAMED_AT_MOST = 15000;
/**
 * Light over distance squared (suns per square parsec) below which a star
 * cannot be seen at all: FIELD_VERTEX drops it then. Keep the two together.
 */
export const FAINTEST = 2e-6;

/** One class of stars on the screen (see starfield.ts). */
interface Layer {
  index: number;
  points: Points<BufferGeometry, RawShaderMaterial>;
  /** Stars of the cells that were made, by cell. */
  made: Map<string, CellStars>;
  /** The cells the camera needs now, and the ones of them still to be made. */
  wanted: { key: string; cell: [number, number, number] }[];
  waiting: { key: string; cell: [number, number, number] }[];
  /** What `wanted` was worked out for, and what the drawn stars are. */
  wantedFor: string;
  drawnFor: string;
  reach: number;
  /** Where the camera was when `wanted` was worked out. */
  from: [number, number, number];
}

/**
 * Draws the stars of starfield.ts around the camera and the landmarks of
 * landmarks.ts. Each frame it works out which cells the camera needs, makes
 * a few of the missing ones (no more than BUDGET_MS a frame) and, once all
 * of a class are there, puts them on the graphics card at once. Until then
 * the stars it had stay, so nothing flickers.
 */
export class StarfieldView {
  readonly group = new Group();
  private plan: Plan = SMOOTH_PLAN;
  /** Classes that reach far need the arms of the galaxy; they wait for the plan from the picture. */
  private planReady = false;
  private readonly layers: Layer[];
  private readonly landmarks: {
    landmark: Landmark;
    glow: Mesh<PlaneGeometry, RawShaderMaterial>;
    members: Points<BufferGeometry, RawShaderMaterial> | null;
  }[] = [];
  private disposed = false;
  /** The globular clusters round the galaxy, as single points. */
  private readonly globulars: Points<BufferGeometry, RawShaderMaterial>;
  /** The clusters of stars in the arms (galaxyClouds.ts), once they are made. */
  private clusters: Points<BufferGeometry, RawShaderMaterial> | null = null;

  /**
   * `picture` is the picture of the galaxy from above (galaxy.ts) as linear
   * red, green and blue, `size` × `size` (picture.ts): the plan of its arms
   * is read from it.
   */
  constructor(picture: Promise<Float32Array>, size: number) {
    this.layers = STAR_CLASSES.map((_, index) => {
      const points = new Points(new BufferGeometry(), fieldMaterial());
      points.frustumCulled = false;
      points.renderOrder = 1.5;
      this.group.add(points);
      return { index, points, made: new Map(), wanted: [], waiting: [], wantedFor: "", drawnFor: "", reach: 0, from: [0, 0, 0] };
    });

    LANDMARKS.forEach((landmark, index) => {
      const glow = new Mesh(
        new PlaneGeometry(2, 2),
        new RawShaderMaterial({
          glslVersion: GLSL3,
          vertexShader: LANDMARK_VERTEX,
          fragmentShader: LANDMARK_FRAGMENT,
          uniforms: {
            uColor: { value: landmark.color },
            uKind: { value: LANDMARK_KINDS.indexOf(landmark.kind) },
            uSeed: { value: (index * 3.7) % 17 },
            uFade: { value: 1 },
          },
          depthTest: false,
          depthWrite: false,
          transparent: true,
          side: DoubleSide,
          ...additive,
        }),
      );
      glow.position.set(...landmark.position);
      // The faint outskirts reach far beyond the bright middle.
      glow.scale.setScalar(landmark.radius * GLOW_SIZE[landmark.kind]);
      glow.renderOrder = 1.4;
      glow.frustumCulled = false;
      this.group.add(glow);
      let members: Points<BufferGeometry, RawShaderMaterial> | null = null;
      if (landmark.members > 0) {
        members = new Points(starGeometry(clusterStars(landmark, index)), fieldMaterial());
        members.frustumCulled = false;
        members.renderOrder = 1.5;
        members.material.uniforms.uReach.value = 1e9;
        this.group.add(members);
      }
      this.landmarks.push({ landmark, glow, members });
    });

    this.globulars = new Points(starGeometry(globularSystem()), fieldMaterial());
    this.globulars.frustumCulled = false;
    this.globulars.renderOrder = 1.5;
    this.globulars.material.uniforms.uReach.value = 1e9;
    this.group.add(this.globulars);

    picture.then(
      (rgb) => {
        if (this.disposed) return;
        this.plan = planOf(rgb, size);
        this.planReady = true;
      },
      // Without the picture the disc is smooth, which is still a galaxy.
      () => {
        this.planReady = true;
      },
    );
  }

  /**
   * Moves the stars along with the camera. `photographed` is how much the
   * photograph of the sky still shows (1 near the Sun): stars it shows itself
   * stay hidden until it fades.
   */
  update(camera: Camera, photographed: number, pixelRatio: number): void {
    const { x, y, z } = camera.position;
    for (const layer of this.layers) {
      const starClass = STAR_CLASSES[layer.index];
      const uniforms = layer.points.material.uniforms;
      uniforms.uPixelRatio.value = pixelRatio;
      uniforms.uFade.value = 1 - photographed * (starClass.photographed ? 1 : 0.8);
      // Far classes need the arms; the near ones are the same either way.
      if (starClass.reach > 200 && !this.planReady) continue;
      const reach = reachAt(starClass, this.plan, x, y, z);
      const size = cellSize(starClass);
      // Steps of a tenth keep a shrinking reach from asking for new cells every frame.
      const steps = Math.round(Math.log(reach) * 10);
      const wantedFor = `${Math.floor(x / size)}:${Math.floor(y / size)}:${Math.floor(z / size)}:${steps}`;
      if (wantedFor !== layer.wantedFor) {
        layer.wantedFor = wantedFor;
        layer.reach = Math.exp(steps / 10);
        layer.from = [x, y, z];
        layer.wanted = cellsAround(layer.index, layer.reach, x, y, z).map((cell) => ({
          key: cellKey(layer.index, ...cell),
          cell,
        }));
        layer.waiting = layer.wanted.filter((item) => !layer.made.has(item.key));
      }
    }

    // Make missing cells, the near classes first, until the time is used up.
    const started = performance.now();
    for (const layer of this.layers) {
      while (layer.waiting.length > 0 && performance.now() - started < BUDGET_MS) {
        const { key, cell } = layer.waiting.shift() as (typeof layer.waiting)[number];
        if (!layer.made.has(key)) layer.made.set(key, cellStars(layer.index, ...cell, this.plan));
      }
      if (layer.waiting.length === 0 && layer.drawnFor !== layer.wantedFor && layer.wantedFor !== "") {
        this.draw(layer);
      }
    }

    this.globulars.material.uniforms.uPixelRatio.value = pixelRatio;
    this.globulars.material.uniforms.uFade.value = 1 - photographed;
    if (this.clusters) this.clusters.material.uniforms.uPixelRatio.value = pixelRatio;
    // Near the Sun the photograph shows the landmarks already: there they
    // are not drawn at all, rather than drawn with no light.
    const shown = photographed < 0.999;
    this.globulars.visible = shown;
    for (const { glow, members } of this.landmarks) {
      glow.visible = shown;
      if (members) members.visible = shown;
      if (!shown) continue;
      // A cloud of gas faces the camera.
      glow.quaternion.copy(camera.quaternion);
      glow.material.uniforms.uFade.value = 1 - photographed;
      if (members) {
        members.material.uniforms.uPixelRatio.value = pixelRatio;
        members.material.uniforms.uFade.value = 1 - photographed;
      }
    }
  }

  /** Shows the clusters of stars in the arms, seven numbers each. */
  addClusters(data: Float32Array): void {
    if (this.disposed) return;
    this.clusters = new Points(starGeometry(data), fieldMaterial());
    this.clusters.frustumCulled = false;
    this.clusters.renderOrder = 1.5;
    this.clusters.material.uniforms.uReach.value = 1e9;
    this.group.add(this.clusters);
  }

  /**
   * How much the clusters of the arms show: like the clouds of the galaxy,
   * only from outside the disc. Inside it the stars of the cells take over,
   * and a cluster a few hundred parsecs away would be a glaring point.
   */
  showClusters(amount: number): void {
    if (!this.clusters) return;
    this.clusters.material.uniforms.uFade.value = amount;
    this.clusters.visible = amount > 0.001;
  }

  /** Puts the stars of the cells a layer needs on the graphics card, and forgets the others. */
  private draw(layer: Layer): void {
    let count = 0;
    for (const { key } of layer.wanted) count += layer.made.get(key)?.count ?? 0;
    const data = new Float32Array(count * 7);
    let at = 0;
    const keep = new Set<string>();
    // Most stars of a class are too faint to see from here. The camera only
    // gets new cells once it has left its cell, so a star that stays too
    // faint even from the nearest point of that reach is left out: the
    // graphics card would only work on it to find that it is invisible.
    const [cx, cy, cz] = layer.from;
    const margin = cellSize(STAR_CLASSES[layer.index]) * 1.8;
    for (const { key } of layer.wanted) {
      const stars = layer.made.get(key);
      if (!stars) continue;
      keep.add(key);
      const source = stars.data;
      for (let i = 0; i < source.length; i += 7) {
        const closest = Math.max(Math.hypot(source[i] - cx, source[i + 1] - cy, source[i + 2] - cz) - margin, 0.01);
        if (closest > layer.reach || source[i + 6] / (closest * closest) < FAINTEST) continue;
        data.set(source.subarray(i, i + 7), at);
        at += 7;
      }
    }
    for (const key of layer.made.keys()) if (!keep.has(key)) layer.made.delete(key);
    layer.points.geometry.dispose();
    layer.points.geometry = starGeometry(data.subarray(0, at));
    layer.points.material.uniforms.uReach.value = layer.reach;
    layer.drawnFor = layer.wantedFor;
  }

  /** The landmarks near enough to name, with where they are. */
  namedLandmarks(camera: Camera): { name: string; position: [number, number, number] }[] {
    return this.landmarks
      .filter(({ landmark }) => {
        const [lx, ly, lz] = landmark.position;
        const distance = Math.hypot(lx - camera.position.x, ly - camera.position.y, lz - camera.position.z);
        return distance < Math.max(NAMED_AT_LEAST, Math.min(NAMED_AT_MOST, landmark.radius * NAMED_WITHIN));
      })
      .map(({ landmark }) => ({ name: landmark.name, position: landmark.position }));
  }

  /** How many stars are drawn now, for tests and measurements. */
  get starCount(): number {
    return this.layers.reduce((sum, layer) => sum + (layer.points.geometry.getAttribute("position")?.count ?? 0), 0);
  }

  dispose(): void {
    this.disposed = true;
    for (const layer of this.layers) {
      layer.points.geometry.dispose();
      layer.points.material.dispose();
    }
    this.globulars.geometry.dispose();
    this.globulars.material.dispose();
    this.clusters?.geometry.dispose();
    this.clusters?.material.dispose();
    for (const { glow, members } of this.landmarks) {
      glow.geometry.dispose();
      glow.material.dispose();
      members?.geometry.dispose();
      members?.material.dispose();
    }
  }
}

function fieldMaterial(): RawShaderMaterial {
  return new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: FIELD_VERTEX,
    fragmentShader: FIELD_FRAGMENT,
    uniforms: { uPixelRatio: { value: 1 }, uReach: { value: 1 }, uFade: { value: 1 } },
    depthTest: false,
    depthWrite: false,
    transparent: true,
    ...additive,
  });
}

/** Stars as seven numbers each (starfield.ts) for the graphics card. */
function starGeometry(data: Float32Array): BufferGeometry {
  const count = data.length / 7;
  const position = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const light = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    position[i * 3] = data[i * 7];
    position[i * 3 + 1] = data[i * 7 + 1];
    position[i * 3 + 2] = data[i * 7 + 2];
    color[i * 3] = data[i * 7 + 3];
    color[i * 3 + 1] = data[i * 7 + 4];
    color[i * 3 + 2] = data[i * 7 + 5];
    light[i] = data[i * 7 + 6];
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(position, 3));
  geometry.setAttribute("color", new BufferAttribute(color, 3));
  geometry.setAttribute("light", new BufferAttribute(light, 1));
  return geometry;
}

/**
 * The plan of the galaxy (starfield.ts) from its picture: the brightness at
 * half the size of the picture, each value the mean of four pixels. The
 * stars follow the arms, not every knot of the painting.
 */
function planOf(rgb: Float32Array, size: number): Plan {
  const half = size / 2;
  const brightness = new Float32Array(half * half);
  for (let row = 0; row < half; row++) {
    for (let column = 0; column < half; column++) {
      let sum = 0;
      for (const at of [2 * row * size + 2 * column, 2 * row * size + 2 * column + 1, (2 * row + 1) * size + 2 * column, (2 * row + 1) * size + 2 * column + 1]) {
        // Linear light, so the bright arms count for more than their grey suggests.
        sum += 0.3 * rgb[at * 3] + 0.6 * rgb[at * 3 + 1] + 0.1 * rgb[at * 3 + 2];
      }
      brightness[row * half + column] = sum / 4;
    }
  }
  return planFromPicture(brightness, half);
}
