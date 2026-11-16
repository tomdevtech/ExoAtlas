import {
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  GLSL3,
  LinearFilter,
  Matrix3,
  Matrix4,
  Mesh,
  OneFactor,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  RawShaderMaterial,
  Scene,
  TextureLoader,
  Vector3,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from "three";
import { isSpecialStar, SPECIAL_STAR_COLOR } from "@/app/stars/my-special-star/star";
import { GALACTIC_CENTRE, GALAXY_EDGE, starColor } from "../galaxy";
import type { MapStar } from "../payload";
import type { LabelKind, LabelLayer } from "./labels";
import {
  COPY_FRAGMENT,
  GALAXY_GLOW_FRAGMENT,
  HOSTS_FRAGMENT,
  HOSTS_VERTEX,
  SCREEN_VERTEX,
} from "./shaders";
import { createSky, type Sky } from "./sky";

/** Size of the drawing area in CSS pixels, and how many device pixels one of them has. */
export interface Viewport {
  width: number;
  height: number;
  pixelRatio: number;
}

/** A camera move that runs by itself, for example to a star. */
interface Flight {
  /** The point the camera looks at and approaches or leaves. */
  focus: Vector3;
  from: Vector3;
  to: Vector3;
  elapsed: number;
  duration: number;
}

/**
 * Adding up the light of the galaxy along every line of sight costs time for
 * each pixel. So it is drawn into a picture of at most this many pixels and
 * stretched over the screen.
 */
const GLOW_PIXELS = 1_300_000;
/** Seconds the galaxy takes to appear once its picture has arrived. */
const ARRIVAL_SECONDS = 0.6;
/**
 * How far from the Sun the photograph of the sky is still right, and from
 * where on the model has taken over, in parsecs. The disc of the galaxy is
 * thin, so leaving it upwards or downwards changes the view four times as
 * fast as moving along it.
 */
const SKY_RANGE: readonly [number, number] = [150, 900];
const MODEL_RANGE: readonly [number, number] = [100, 700];
const HEIGHT_COUNTS = 4;
/** Where the map opens: a few parsecs from the Sun, looking past it at the galactic centre. */
const HOME = new Vector3(-9, -6.5, 4);
const OVERVIEW = new Vector3(GALACTIC_CENTRE[0] - 15000, -13000, 21000);
const CENTRE = new Vector3(...GALACTIC_CENTRE);
/** How close a flight to a star ends, in parsecs. */
const ARRIVAL_DISTANCE = 0.45;
/** How many of the stars next to the camera get a name. */
const LABELLED_NEIGHBOURS = 8;
/** How many are considered for one: some are behind the camera or off the screen. */
const NEIGHBOUR_CANDIDATES = 40;
const NEIGHBOUR_RANGE = 45;
/** How far from a star a click still counts, in CSS pixels. */
const PICK_RADIUS = 14;
/** Closer to the galactic centre than this, in parsecs, the special star there shows its name. */
const SPECIAL_STAR_REVEAL = 3000;

const additive = { blending: CustomBlending, blendSrc: OneFactor, blendDst: OneFactor } as const;

/**
 * The galaxy: the stars with planets at their real positions, the Milky Way
 * around them, and a camera that flies freely.
 *
 * Lengths are parsecs, the Sun is at the origin and z points to the galactic
 * north. Near the Sun the sky is a photograph of the real Milky Way. A little
 * further out the photograph would be wrong, because it shows the view from
 * here, so it fades into the computed model of the galaxy. From outside the
 * galaxy there is nothing behind it but black.
 */
export class GalaxyView {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(55, 1, 0.0005, 500_000);

  selected: number | null = null;
  hovered: number | null = null;

  private stars: MapStar[] = [];
  private coords = new Float32Array(0);
  private sunIndex = -1;
  private specialIndex = -1;
  private hosts: Points<BufferGeometry, RawShaderMaterial> | null = null;
  private readonly sky: Sky;
  /**
   * The galaxy is first drawn into a picture of its own and from there onto
   * the screen (see GLOW_PIXELS).
   */
  private readonly glow: {
    scene: Scene;
    source: Mesh<PlaneGeometry, RawShaderMaterial>;
    target: WebGLRenderTarget;
    screen: Mesh<PlaneGeometry, RawShaderMaterial>;
  };
  /** What the picture of the glow was last drawn from: while nothing of it changes, the picture stays. */
  private drawnFrom = "";
  /**
   * The artist's impression of the galaxy. It is only fetched when the camera
   * leaves the neighbourhood of the Sun, where the photograph of the sky is
   * enough. `arrived` runs from 0 to 1 once it is there, so the galaxy fades in.
   */
  private picture: Texture | null = null;
  private arrived = 0;

  private readonly position = HOME.clone();
  private yaw = 0;
  private pitch = 0;
  private readonly velocity = new Vector3();
  private dolly = 0;
  private flight: Flight | null = null;
  /** Distance the camera covers per second at normal speed, in parsecs. */
  private pace = 1;
  private neighbours: { index: number; distance: number }[] = [];
  private readonly viewProjection = new Matrix4();
  private readonly scratch = new Vector3();

  /** `pictureUrl` is where the artist's impression of the galaxy can be fetched. */
  constructor(
    skyTexture: Texture,
    private readonly pictureUrl: string,
  ) {
    this.camera.up.set(0, 0, 1);
    this.lookAt(new Vector3(0, 0, 0));

    this.sky = createSky(skyTexture, new Matrix3());
    this.scene.add(this.sky.mesh);

    const source = new Mesh(
      new PlaneGeometry(2, 2),
      new RawShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: SCREEN_VERTEX,
        fragmentShader: GALAXY_GLOW_FRAGMENT,
        uniforms: {
          uMap: { value: null },
          uEye: { value: new Vector3() },
          uForward: { value: new Vector3() },
          uRight: { value: new Vector3() },
          uUp: { value: new Vector3() },
          uFade: { value: 0 },
          uOutside: { value: 1 },
        },
        depthTest: false,
        depthWrite: false,
      }),
    );
    source.frustumCulled = false;
    const target = new WebGLRenderTarget(1, 1, {
      depthBuffer: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
    });
    const screen = new Mesh(
      new PlaneGeometry(2, 2),
      new RawShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: SCREEN_VERTEX,
        fragmentShader: COPY_FRAGMENT,
        uniforms: { uMap: { value: target.texture } },
        depthTest: false,
        depthWrite: false,
        transparent: true,
        ...additive,
      }),
    );
    screen.frustumCulled = false;
    screen.renderOrder = 1;
    this.scene.add(screen);
    this.glow = { scene: new Scene().add(source), source, target, screen };
  }

  /** Draws the galaxy. Call after `update`. */
  render(renderer: WebGLRenderer, viewport: Viewport): void {
    const { scene, source, target, screen } = this.glow;
    screen.visible = source.material.uniforms.uFade.value > 0.001;
    if (screen.visible) {
      const scale = Math.min(1, Math.sqrt(GLOW_PIXELS / (viewport.width * viewport.height)));
      const width = Math.max(1, Math.round(viewport.width * scale));
      const height = Math.max(1, Math.round(viewport.height * scale));
      if (target.width !== width || target.height !== height) target.setSize(width, height);
      // The glow is the costly part of the picture. While the camera rests,
      // the one that is there is shown again.
      const { uEye, uForward, uRight, uUp, uFade, uOutside } = source.material.uniforms;
      const from = JSON.stringify([width, height, uEye.value, uForward.value, uRight.value, uUp.value, uFade.value, uOutside.value]);
      if (from !== this.drawnFrom) {
        this.drawnFrom = from;
        renderer.setRenderTarget(target);
        renderer.render(scene, this.camera);
        renderer.setRenderTarget(null);
      }
    }
    renderer.render(this.scene, this.camera);
  }

  /** Hands over the stars with planets. Called once, when they have loaded. */
  setStars(stars: MapStar[]): void {
    this.stars = stars;
    this.coords = new Float32Array(stars.length * 3);
    const colors = new Float32Array(stars.length * 3);
    const weights = new Float32Array(stars.length);
    stars.forEach(([slug, , x, y, z, teffK, planetCount], index) => {
      this.coords.set([x, y, z], index * 3);
      const special = isSpecialStar(slug);
      colors.set(special ? SPECIAL_STAR_COLOR : starColor(teffK), index * 3);
      weights[index] = special ? 1 : Math.min((planetCount - 1) / 6, 1);
      if (slug === "sun") this.sunIndex = index;
      if (special) this.specialIndex = index;
    });

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.coords, 3));
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
    geometry.setAttribute("weight", new BufferAttribute(weights, 1));
    this.hosts = new Points(
      geometry,
      new RawShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: HOSTS_VERTEX,
        fragmentShader: HOSTS_FRAGMENT,
        uniforms: { uPixelsPerUnit: { value: 1 }, uPixelRatio: { value: 1 } },
        depthTest: false,
        depthWrite: false,
        transparent: true,
        ...additive,
      }),
    );
    this.hosts.frustumCulled = false;
    this.hosts.renderOrder = 2;
    this.scene.add(this.hosts);
  }

  // ---- Moving the camera -----------------------------------------------------

  /** Turns the view, as if the sky were grabbed and pulled. Pixels in, angles out. */
  drag(dx: number, dy: number): void {
    this.flight = null;
    this.yaw += dx * 0.0032;
    this.pitch = clamp(this.pitch + dy * 0.0032, -1.55, 1.55);
  }

  /** Moves forwards (positive) or backwards. One notch of a mouse wheel is about 1. */
  push(amount: number): void {
    this.flight = null;
    this.dolly = clamp(this.dolly + amount * 0.3, -3, 3);
  }

  flyToStar(index: number, instantly = false): void {
    const star = this.starPosition(index, new Vector3());
    const away = this.position.clone().sub(star);
    if (away.lengthSq() < 1e-8) away.set(-1, -0.6, 0.4);
    this.fly(star, star.clone().addScaledVector(away.normalize(), ARRIVAL_DISTANCE), instantly);
  }

  flyHome(instantly = false): void {
    this.fly(new Vector3(0, 0, 0), HOME, instantly);
  }

  flyToOverview(instantly = false): void {
    this.fly(CENTRE, OVERVIEW, instantly);
  }

  private fly(focus: Vector3, to: Vector3, instantly: boolean): void {
    this.velocity.set(0, 0, 0);
    this.dolly = 0;
    if (instantly) {
      this.flight = null;
      this.position.copy(to);
      this.lookAt(focus);
      return;
    }
    const before = Math.max(this.position.distanceTo(focus), 1e-3);
    const after = Math.max(to.distanceTo(focus), 1e-3);
    const sideways = this.position.distanceTo(to) / Math.max(before, after);
    this.flight = {
      focus: focus.clone(),
      from: this.position.clone(),
      to: to.clone(),
      elapsed: 0,
      duration: clamp(1.4 + 0.3 * Math.abs(Math.log(before / after)) + 0.6 * sideways, 1.4, 5),
    };
  }

  private lookAt(point: Vector3): void {
    const d = this.scratch.copy(point).sub(this.position);
    if (d.lengthSq() < 1e-12) return;
    this.yaw = Math.atan2(d.y, d.x);
    this.pitch = Math.atan2(d.z, Math.hypot(d.x, d.y));
  }

  /**
   * Advances the camera by `dt` seconds. `keys` holds the codes of the keys
   * that are down.
   */
  update(dt: number, keys: ReadonlySet<string>, viewport: Viewport): void {
    this.measureSurroundings();

    const cosPitch = Math.cos(this.pitch);
    const forward = new Vector3(
      cosPitch * Math.cos(this.yaw),
      cosPitch * Math.sin(this.yaw),
      Math.sin(this.pitch),
    );
    const right = new Vector3(Math.sin(this.yaw), -Math.cos(this.yaw), 0);

    const wish = new Vector3();
    if (keys.has("KeyW") || keys.has("ArrowUp")) wish.add(forward);
    if (keys.has("KeyS") || keys.has("ArrowDown")) wish.sub(forward);
    if (keys.has("KeyD") || keys.has("ArrowRight")) wish.add(right);
    if (keys.has("KeyA") || keys.has("ArrowLeft")) wish.sub(right);
    if (keys.has("KeyE") || keys.has("Space")) wish.z += 1;
    if (keys.has("KeyQ") || keys.has("KeyC")) wish.z -= 1;
    if (wish.lengthSq() > 0) {
      this.flight = null;
      const fast = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 6 : 1;
      wish.normalize().multiplyScalar(this.pace * fast);
    }

    if (this.flight) {
      this.advanceFlight(this.flight, dt);
    } else {
      // Speed follows the keys softly, so starting and stopping do not jerk.
      this.velocity.lerp(wish, 1 - Math.exp(-dt * 7));
      this.position.addScaledVector(this.velocity, dt);
      const step = this.dolly * (1 - Math.exp(-dt * 9));
      this.dolly -= step;
      this.position.addScaledVector(forward, step * this.pace * 1.6);
      if (this.position.length() > 150_000) this.position.setLength(150_000);
    }

    this.camera.aspect = viewport.width / viewport.height;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(this.position);
    const cos = Math.cos(this.pitch);
    this.camera.lookAt(
      this.position.x + cos * Math.cos(this.yaw),
      this.position.y + cos * Math.sin(this.yaw),
      this.position.z + Math.sin(this.pitch),
    );
    this.camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);

    // Pixels a parsec covers at a distance of one parsec.
    const cssPixelsPerUnit = viewport.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    const pixelsPerUnit = cssPixelsPerUnit * viewport.pixelRatio;
    // How far the view has left the one from the Sun.
    const away = Math.hypot(this.position.x, this.position.y, this.position.z * HEIGHT_COUNTS);
    this.sky.setOpacity(1 - smoothstep(SKY_RANGE[0], SKY_RANGE[1], away));
    const wanted = smoothstep(MODEL_RANGE[0], MODEL_RANGE[1], away);
    const glow = this.glow.source.material.uniforms;
    if (wanted > 0 && !this.picture) {
      this.picture = new TextureLoader().load(this.pictureUrl, (picture) => {
        glow.uMap.value = picture;
      });
    }
    if (glow.uMap.value) this.arrived = Math.min(1, this.arrived + dt / ARRIVAL_SECONDS);
    const fade = wanted * this.arrived;
    // The line of sight of every pixel: forwards, plus so much to the right and upwards.
    const reach = Math.tan((this.camera.fov * Math.PI) / 360);
    const view = this.camera.matrixWorld.elements;
    glow.uFade.value = fade;
    // Whether the camera is inside the disc, where the galaxy is all around,
    // or outside, where it is a thing to look at (see GALAXY_GLOW_FRAGMENT).
    const fromCentre = Math.hypot(this.position.x - CENTRE.x, this.position.y - CENTRE.y);
    const outside = Math.max(
      smoothstep(200, 1500, Math.abs(this.position.z)),
      smoothstep(GALAXY_EDGE * 0.8, GALAXY_EDGE, fromCentre),
    );
    glow.uOutside.value = outside;
    (glow.uEye.value as Vector3).copy(this.position);
    (glow.uRight.value as Vector3).set(view[0], view[1], view[2]).multiplyScalar(reach * this.camera.aspect);
    (glow.uUp.value as Vector3).set(view[4], view[5], view[6]).multiplyScalar(reach);
    (glow.uForward.value as Vector3).set(-view[8], -view[9], -view[10]);
    if (this.hosts) {
      this.hosts.material.uniforms.uPixelsPerUnit.value = pixelsPerUnit;
      this.hosts.material.uniforms.uPixelRatio.value = viewport.pixelRatio;
    }
  }

  private advanceFlight(flight: Flight, dt: number): void {
    flight.elapsed += dt;
    const t = Math.min(flight.elapsed / flight.duration, 1);
    const eased = t * t * t * (t * (t * 6 - 15) + 10);

    // The distance to the focus shrinks or grows by the same factor per moment:
    // the approach to a star slows down on its own, however far the flight was.
    const start = flight.from.clone().sub(flight.focus);
    const end = flight.to.clone().sub(flight.focus);
    const startDistance = Math.max(start.length(), 1e-3);
    const endDistance = Math.max(end.length(), 1e-3);
    const distance = Math.exp(
      Math.log(startDistance) + (Math.log(endDistance) - Math.log(startDistance)) * eased,
    );
    const direction = start.normalize().lerp(end.normalize(), eased);
    if (direction.lengthSq() < 1e-8) direction.copy(end);
    this.position.copy(flight.focus).addScaledVector(direction.normalize(), distance);

    // Turn towards the focus, the short way round.
    const d = this.scratch.copy(flight.focus).sub(this.position);
    const blend = Math.max(1 - Math.exp(-dt * 6), eased * eased);
    const wantYaw = Math.atan2(d.y, d.x);
    const wantPitch = Math.atan2(d.z, Math.hypot(d.x, d.y));
    let turn = (wantYaw - this.yaw) % (2 * Math.PI);
    if (turn > Math.PI) turn -= 2 * Math.PI;
    if (turn < -Math.PI) turn += 2 * Math.PI;
    this.yaw += turn * blend;
    this.pitch += (wantPitch - this.pitch) * blend;

    if (t >= 1) this.flight = null;
  }

  /** Finds the stars next to the camera: they set the pace and get a name. */
  private measureSurroundings(): void {
    const { x, y, z } = this.position;
    const near: { index: number; distance: number }[] = [];
    let nearest = Infinity;
    for (let i = 0; i < this.stars.length; i++) {
      const dx = this.coords[i * 3] - x;
      const dy = this.coords[i * 3 + 1] - y;
      const dz = this.coords[i * 3 + 2] - z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance < nearest) nearest = distance;
      if (distance > NEIGHBOUR_RANGE) continue;
      if (near.length === NEIGHBOUR_CANDIDATES && distance >= near[near.length - 1].distance) continue;
      let slot = near.length;
      while (slot > 0 && near[slot - 1].distance > distance) slot--;
      near.splice(slot, 0, { index: i, distance });
      if (near.length > NEIGHBOUR_CANDIDATES) near.pop();
    }
    this.neighbours = near;
    // Slow between close stars, fast in the emptiness between the arms.
    const fromSun = this.position.length();
    this.pace = Math.max(0.25, fromSun * 0.03, Number.isFinite(nearest) ? nearest * 0.8 : 1);
  }

  // ---- Stars on the screen ---------------------------------------------------

  starPosition(index: number, out: Vector3): Vector3 {
    return out.set(this.coords[index * 3], this.coords[index * 3 + 1], this.coords[index * 3 + 2]);
  }

  /** Distance from the camera to a star in parsecs. */
  distanceTo(index: number): number {
    return this.starPosition(index, this.scratch).distanceTo(this.position);
  }

  /** Where a point of the galaxy is on the screen, in CSS pixels, or null behind the camera. */
  private project(x: number, y: number, z: number, viewport: Viewport): [number, number, number] | null {
    const m = this.viewProjection.elements;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 1e-6) return null;
    const sx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    const sy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    return [(sx * 0.5 + 0.5) * viewport.width, (0.5 - sy * 0.5) * viewport.height, w];
  }

  /** The star under the point (x, y) in CSS pixels, or null. Of several, the nearest one wins. */
  pick(x: number, y: number, viewport: Viewport): number | null {
    let best: number | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < this.stars.length; i++) {
      const point = this.project(this.coords[i * 3], this.coords[i * 3 + 1], this.coords[i * 3 + 2], viewport);
      if (!point) continue;
      const offset = Math.hypot(point[0] - x, point[1] - y);
      if (offset > PICK_RADIUS) continue;
      // Mostly the star closest to the pointer, but a much nearer star beats one behind it.
      const score = offset + Math.log10(point[2] + 1) * 3;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  drawLabels(labels: LabelLayer, viewport: Viewport): void {
    const inside = (point: [number, number, number] | null): point is [number, number, number] =>
      point !== null &&
      point[0] > -50 &&
      point[0] < viewport.width + 50 &&
      point[1] > -20 &&
      point[1] < viewport.height + 20;
    const starPoint = (index: number) =>
      this.project(this.coords[index * 3], this.coords[index * 3 + 1], this.coords[index * 3 + 2], viewport);

    const shown = new Set<number>();
    const name = (index: number, kind: LabelKind): boolean => {
      if (shown.has(index)) return false;
      const point = starPoint(index);
      if (!inside(point)) return false;
      shown.add(index);
      labels.put(this.stars[index][1], point[0], point[1], index === this.specialIndex ? "special" : kind);
      if (index === this.selected) labels.mark(point[0], point[1], 13);
      return true;
    };

    if (this.selected !== null) name(this.selected, "strong");
    if (this.hovered !== null) name(this.hovered, "strong");
    if (this.sunIndex >= 0) name(this.sunIndex, "plain");
    const nearCentre = this.position.distanceTo(CENTRE) < SPECIAL_STAR_REVEAL;
    if (this.specialIndex >= 0 && nearCentre) name(this.specialIndex, "special");
    let named = 0;
    for (const neighbour of this.neighbours) {
      if (named === LABELLED_NEIGHBOURS) break;
      if (name(neighbour.index, "faint")) named++;
    }

    // Near the centre the special star there takes over the label.
    const specialShown = this.specialIndex >= 0 && shown.has(this.specialIndex);
    if (this.position.length() > 1500 && !specialShown) {
      const centre = this.project(CENTRE.x, CENTRE.y, CENTRE.z, viewport);
      if (inside(centre)) labels.put("Galactic centre", centre[0], centre[1], "faint", 0);
    }
  }

  dispose(): void {
    this.picture?.dispose();
    this.glow.source.geometry.dispose();
    this.glow.source.material.dispose();
    this.glow.target.dispose();
    this.glow.screen.geometry.dispose();
    this.glow.screen.material.dispose();
    this.hosts?.geometry.dispose();
    this.hosts?.material.dispose();
    this.sky.dispose();
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function smoothstep(low: number, high: number, value: number): number {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
}
