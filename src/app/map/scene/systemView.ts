import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  Data3DTexture,
  DataTexture,
  DoubleSide,
  FloatType,
  GLSL3,
  Group,
  Line,
  LineBasicMaterial,
  LinearFilter,
  Matrix3,
  Mesh,
  OneFactor,
  PerspectiveCamera,
  PlaneGeometry,
  RawShaderMaterial,
  RedFormat,
  RepeatWrapping,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
  type IUniform,
  type Texture,
} from "three";
import { NOISE_SIZE, noiseVolume } from "@/app/planets/globe/noise";
import { linearColor, seedOffset, type GlobeSpec } from "@/app/planets/globe/spec";
import { stormUniforms } from "@/app/planets/globe/storms";
import { surfaceDefines, surfaceUniforms, textureUrls } from "@/app/planets/globe/uniforms";
import { starColor } from "../galaxy";
import { layoutOrbits, orbitPoint, starSize, type OrbitLayout } from "../orbits";
import type { MapSystemPayload } from "../payload";
import type { Viewport } from "./galaxyView";
import type { LabelLayer } from "./labels";
import {
  BALL_VERTEX,
  GLOW_FRAGMENT,
  GLOW_VERTEX,
  HAZE_FRAGMENT,
  MOON_FRAGMENT,
  PLANET_FRAGMENT,
  RING_FRAGMENT,
  RING_VERTEX,
  STAR_FRAGMENT,
} from "./shaders";
import { createSky, type Sky } from "./sky";
import { loadTexture } from "./picture";

/** Loads each texture only once, however many planets use it, and decodes it off the main thread. */
export class TextureStore {
  private readonly textures = new Map<string, Texture>();
  private readonly waiting = new Map<string, ((texture: Texture | null) => void)[]>();
  /** A placeholder for shader texture slots that a planet does not use. */
  readonly blank: Texture;
  /** The 3D noise volume used for clouds and fine surface detail. */
  readonly noise: Data3DTexture;

  constructor(private readonly anisotropy: number) {
    this.blank = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.blank.needsUpdate = true;

    this.noise = new Data3DTexture(noiseVolume(), NOISE_SIZE, NOISE_SIZE, NOISE_SIZE);
    this.noise.format = RedFormat;
    this.noise.type = FloatType;
    // Half floats are precise enough, and unlike full floats they can be filtered on every WebGL 2 device.
    this.noise.internalFormat = "R16F";
    this.noise.minFilter = LinearFilter;
    this.noise.magFilter = LinearFilter;
    this.noise.wrapS = RepeatWrapping;
    this.noise.wrapT = RepeatWrapping;
    this.noise.wrapR = RepeatWrapping;
    this.noise.generateMipmaps = false;
    this.noise.unpackAlignment = 1;
    this.noise.needsUpdate = true;
  }

  /**
   * Returns the texture for `url`. `onDone` is called once the texture has loaded (immediately if it
   * already has), or with `null` if loading failed.
   */
  get(url: string, onDone: (texture: Texture | null) => void = () => {}): Texture {
    const known = this.textures.get(url);
    if (known) {
      const queue = this.waiting.get(url);
      if (queue) queue.push(onDone);
      else onDone(known);
      return known;
    }
    this.waiting.set(url, [onDone]);
    const settle = (result: Texture | null) => {
      const queue = this.waiting.get(url) ?? [];
      this.waiting.delete(url);
      for (const callback of queue) callback(result);
    };
    const texture = loadTexture(
      url,
      () => settle(texture),
      () => {
        // A failed texture is removed from the cache so that the next system that needs it tries again.
        this.textures.delete(url);
        texture.dispose();
        settle(null);
      },
    );
    texture.wrapS = RepeatWrapping;
    texture.anisotropy = this.anisotropy;
    this.textures.set(url, texture);
    return texture;
  }

  dispose(): void {
    for (const texture of this.textures.values()) texture.dispose();
    this.blank.dispose();
    this.noise.dispose();
  }
}

interface Body {
  layout: OrbitLayout;
  name: string;
  spec: GlobeSpec;
  /** Whether the high-resolution maps have been requested (see `sharpen`). */
  sharp: boolean;
  /** The group that moves along the orbit. */
  anchor: Group;
  /** The planet mesh, which spins around the tilted axis. */
  ball: Mesh<SphereGeometry, RawShaderMaterial>;
  ring: Mesh<RingGeometry, RawShaderMaterial> | null;
  haze: Mesh<SphereGeometry, RawShaderMaterial> | null;
  moon: Mesh<SphereGeometry, RawShaderMaterial> | null;
  orbit: Line<BufferGeometry, LineBasicMaterial>;
  spin: number;
  spinStart: number;
}

export type SystemHit = { kind: "planet"; index: number } | { kind: "star" };

const SPIN_RATE = (Math.PI * 2) / 40;
const ORBIT_SEGMENTS = 256;
const SUN_MAP = "/textures/planets/sun-lg.jpg";
/** The angle in radians between the planet–star line and the camera direction when a planet is first followed. */
const DAYLIGHT_OFFSET = 0.9;
/** While the camera follows a planet, time slows so that one orbit takes at least this many seconds. */
const FOLLOWED_PERIOD = 90;

/**
 * Renders one star with its planets on their orbits. Lengths are in arbitrary display units: the star
 * has a radius of about 1, orbits are compressed and planets enlarged (see orbits.ts), and the orbits
 * lie in the plane y = 0. The planets use the same shader as the 3D model on their detail pages.
 */
export class SystemView {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(45, 1, 0.02, 4000);

  /** The payload index of the planet the camera follows, or null when showing the whole system. */
  focused: number | null = null;
  paused = false;

  private readonly bodies: Body[] = [];
  private readonly star: Mesh<SphereGeometry, RawShaderMaterial>;
  private readonly glow: Mesh<PlaneGeometry, RawShaderMaterial>;
  private readonly sky: Sky;
  private readonly ballGeometry = new SphereGeometry(1, 96, 48);
  private readonly starRadius: number;
  /** The radius of the largest orbit, used to fit the overview. */
  private readonly extent: number;

  private clock = 0;
  /** The orbit speed factor, which is 1 normally and lower while the camera follows a fast planet. */
  private rate = 1;
  private azimuth = 0.6;
  /** The remaining rotation from the previous view direction, which decays so that focus changes glide. */
  private swing = 0;
  private elevation = 0.48;
  private distance = 10;
  private distanceGoal = 10;
  private fitted = false;
  private readonly target = new Vector3();
  /** The remaining offset from the previous target, which decays so that focus changes glide. */
  private readonly lag = new Vector3();
  private readonly scratch = new Vector3();

  constructor(
    private readonly payload: MapSystemPayload,
    private readonly textures: TextureStore,
    skyTexture: Texture,
  ) {
    const { star, planets } = payload;
    const seed = hashText(star.slug);

    // The orbital plane is tilted against the Milky Way, as it is in the solar system.
    const tilt = (60 * Math.PI) / 180;
    const c = Math.cos(tilt);
    const s = Math.sin(tilt);
    this.sky = createSky(skyTexture, new Matrix3().set(1, 0, 0, 0, -s, -c, 0, c, -s));
    this.sky.setOpacity(0.55);
    this.scene.add(this.sky.mesh);

    this.starRadius = starSize(star.radiusSun);
    const display = starColor(star.teffK);
    const linear = display.map((channel) => channel ** 2.2);
    const brightest = Math.max(...linear);
    this.star = new Mesh(
      this.ballGeometry,
      new RawShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: BALL_VERTEX,
        fragmentShader: STAR_FRAGMENT,
        uniforms: {
          uColor: { value: linear.map((channel) => channel / brightest) },
          uSeed: { value: seedOffset(seed % 9973) },
          uTime: { value: 0 },
          uHasMap: { value: star.isSun ? 1 : 0 },
          uMapDay: { value: star.isSun ? textures.get(SUN_MAP) : textures.blank },
          uNoise: { value: textures.noise },
          uCameraObject: { value: new Vector3() },
        },
      }),
    );
    this.star.scale.setScalar(this.starRadius);
    this.scene.add(this.star);

    const glowSize = this.starRadius * 9;
    this.glow = new Mesh(
      new PlaneGeometry(1, 1),
      new RawShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: GLOW_VERTEX,
        fragmentShader: GLOW_FRAGMENT,
        uniforms: { uColor: { value: display }, uCore: { value: 2 / 9 } },
        transparent: true,
        depthWrite: false,
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneFactor,
      }),
    );
    this.glow.scale.setScalar(glowSize);
    this.scene.add(this.glow);

    const layouts = layoutOrbits(planets, star, seed);
    for (const layout of layouts) {
      this.bodies.push(this.createBody(layout));
    }
    this.extent = layouts.reduce(
      (extent, layout) => Math.max(extent, layout.semiMajor * (1 + layout.eccentricity)),
      this.starRadius * 3,
    );
    this.placeBodies(0);
  }

  private createBody(layout: OrbitLayout): Body {
    const { textures } = this;
    const planet = this.payload.planets[layout.index];
    const spec = planet.globe;
    // On its orbit a planet is only a few dozen pixels wide, so the small maps are enough until the
    // camera follows it (see `sharpen`).
    const urls = textureUrls(spec, "sm");

    const anchor = new Group();
    const axis = new Group();
    axis.rotation.z = (-spec.tiltDeg * Math.PI) / 180;
    anchor.add(axis);

    // The planet stays hidden until its maps have loaded so that it does not flash black. A map that
    // fails to load also counts as done, so the planet never stays hidden for ever.
    let pending = 1;
    const loaded = () => {
      pending--;
      if (pending === 0) anchor.visible = true;
    };
    const map = (url: string | null) => {
      if (!url) return textures.blank;
      pending++;
      return textures.get(url, loaded);
    };
    anchor.visible = false;

    const uniforms: Record<string, IUniform> = {
      uTime: { value: 0 },
      uDetail: { value: 0 },
      uMapDay: { value: map(urls.day) },
      uMapNight: { value: map(urls.night) },
      uMapClouds: { value: map(urls.clouds) },
      uRingMap: { value: map(urls.ring) },
      uNoise: { value: textures.noise },
      uLightObject: { value: new Vector3() },
      uCameraObject: { value: new Vector3() },
    };
    for (const [name, value] of Object.entries({ ...surfaceUniforms(spec), ...stormUniforms(spec, 0) })) uniforms[name] = { value };
    // The defines ensure that only the shader code this planet needs is compiled.
    const defines = { ...surfaceDefines(spec) };

    const ball = new Mesh(
      this.ballGeometry,
      new RawShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: BALL_VERTEX,
        fragmentShader: PLANET_FRAGMENT,
        defines,
        uniforms,
      }),
    );
    // Fast-spinning giants are flattened at the poles.
    ball.scale.set(layout.size, layout.size * (1 - spec.flattening), layout.size);
    axis.add(ball);

    let ring: Body["ring"] = null;
    if (spec.rings) {
      ring = new Mesh(
        new RingGeometry(spec.rings.inner, spec.rings.outer, 160, 1),
        new RawShaderMaterial({
          glslVersion: GLSL3,
          vertexShader: RING_VERTEX,
          fragmentShader: RING_FRAGMENT,
          defines,
          // The rings share the planet's uniforms so they use the same maps and lighting. Only the light
          // and camera directions are separate, because the disc does not spin with the planet.
          uniforms: {
            ...uniforms,
            uLightObject: { value: new Vector3() },
            uCameraObject: { value: new Vector3() },
          },
          side: DoubleSide,
          transparent: true,
          depthWrite: false,
        }),
      );
      // RingGeometry is built upright, so it is laid flat into the equatorial plane.
      ring.rotation.x = -Math.PI / 2;
      ring.scale.setScalar(layout.size);
      axis.add(ring);
    }

    let haze: Body["haze"] = null;
    if (spec.atmosphere) {
      const shell = 1 + (0.03 + 0.07 * spec.atmosphere.density) * 1.6;
      haze = new Mesh(
        this.ballGeometry,
        new RawShaderMaterial({
          glslVersion: GLSL3,
          vertexShader: BALL_VERTEX,
          fragmentShader: HAZE_FRAGMENT,
          uniforms: {
            uColor: { value: linearColor(spec.atmosphere.color) },
            uStrength: { value: 0.35 + 0.45 * spec.atmosphere.density },
            uShell: { value: shell },
            uLightObject: { value: new Vector3() },
            uCameraObject: { value: new Vector3() },
          },
          side: BackSide,
          transparent: true,
          depthWrite: false,
          blending: CustomBlending,
          blendSrc: OneFactor,
          blendDst: OneFactor,
        }),
      );
      haze.scale.set(layout.size * shell, layout.size * shell * (1 - spec.flattening), layout.size * shell);
      axis.add(haze);
    }

    let moon: Body["moon"] = null;
    if (spec.moon) {
      moon = new Mesh(
        this.ballGeometry,
        new RawShaderMaterial({
          glslVersion: GLSL3,
          vertexShader: BALL_VERTEX,
          fragmentShader: MOON_FRAGMENT,
          uniforms: {
            uSeed: uniforms.uSeed,
            uLight: uniforms.uLight,
            uNoise: uniforms.uNoise,
            uLightObject: { value: new Vector3() },
          },
        }),
      );
      moon.scale.setScalar(layout.size * spec.moon.size);
      // The moon is attached to the tilted axis so that its orbit lies in the planet's equatorial plane.
      axis.add(moon);
    }

    const points = new Float32Array((ORBIT_SEGMENTS + 1) * 3);
    for (let i = 0; i <= ORBIT_SEGMENTS; i++) {
      const [x, y] = orbitPoint(
        layout.semiMajor,
        layout.eccentricity,
        layout.periapsis,
        (i / ORBIT_SEGMENTS) * 2 * Math.PI,
      );
      points.set([x, 0, -y], i * 3);
    }
    const orbitGeometry = new BufferGeometry();
    orbitGeometry.setAttribute("position", new BufferAttribute(points, 3));
    const orbit = new Line(
      orbitGeometry,
      new LineBasicMaterial({ color: 0x8fa3c8, transparent: true, opacity: 0.3, depthWrite: false }),
    );

    this.scene.add(anchor, orbit);
    loaded();
    return {
      layout,
      name: planet.name,
      spec,
      sharp: false,
      anchor,
      ball,
      ring,
      haze,
      moon,
      orbit,
      spin: spec.spin,
      spinStart: ((spec.seed * 0.618) % 1) * Math.PI * 2,
    };
  }

  /**
   * Replaces a planet's small maps with the large ones, each as soon as it has loaded. This happens once,
   * when the camera first follows the planet.
   */
  private sharpen(body: Body): void {
    if (body.sharp) return;
    body.sharp = true;
    const urls = textureUrls(body.spec, "lg");
    // The rings share these uniforms with the planet, so they are updated as well.
    const { uniforms } = body.ball.material;
    const swap = (name: string, url: string | null) => {
      if (!url) return;
      this.textures.get(url, (texture) => {
        if (texture) uniforms[name].value = texture;
      });
    };
    swap("uMapDay", urls.day);
    swap("uMapNight", urls.night);
    swap("uMapClouds", urls.clouds);
  }

  /** Orbits the camera around its target. */
  drag(dx: number, dy: number): void {
    this.azimuth += dx * 0.005;
    this.elevation = clamp(this.elevation + dy * 0.005, -1.45, 1.45);
  }

  /** Moves the camera closer for positive amounts and away for negative ones. One mouse wheel notch is about 1. */
  push(amount: number): void {
    const body = this.focusedBody();
    const nearest = body ? body.layout.size * 2.2 : this.starRadius * 2.4;
    this.distanceGoal = clamp(this.distanceGoal * Math.exp(-amount * 0.2), nearest, this.extent * 9);
  }

  /** Follows a planet, or shows the whole system when `index` is null. */
  focus(index: number | null): void {
    const before = this.focusPoint(new Vector3());
    this.focused = index;
    const body = this.focusedBody();
    // The old target is kept as a decaying offset so the camera glides over instead of jumping.
    this.lag.add(before).sub(this.focusPoint(this.scratch));
    if (body) {
      this.sharpen(body);
      // The camera looks from the star's side, slightly off the line to it, so that most of the planet
      // is in daylight and the star does not block the view.
      const turned = this.azimuth + this.swing;
      const { x, z } = body.anchor.position;
      this.azimuth = Math.atan2(-z, -x) + DAYLIGHT_OFFSET;
      this.swing = wrapAngle(turned - this.azimuth);
    }
    this.distanceGoal = body
      ? body.layout.size * (body.ring ? 13 : 6.5)
      : this.overviewDistance(this.camera.aspect);
  }

  private focusedBody(): Body | null {
    return this.bodies.find((body) => body.layout.index === this.focused) ?? null;
  }

  private focusPoint(out: Vector3): Vector3 {
    const body = this.focusedBody();
    return body ? out.copy(body.anchor.position) : out.set(0, 0, 0);
  }

  /** Returns the camera distance at which the whole system fits on the screen. */
  private overviewDistance(aspect: number): number {
    return this.extent * 2.7 * Math.max(1, 1 / aspect);
  }

  /** Positions every planet on its orbit and updates its rotation and shader time. */
  private placeBodies(seconds: number): void {
    for (const body of this.bodies) {
      const { layout } = body;
      const [x, y] = orbitPoint(
        layout.semiMajor,
        layout.eccentricity,
        layout.periapsis,
        layout.phase + (this.clock / layout.period) * 2 * Math.PI,
      );
      body.anchor.position.set(x, 0, -y);
      // A tidally locked rocky planet rotates once per orbit. All other planets spin at their own pace,
      // including locked gas giants, whose winds carry the clouds around.
      body.ball.rotation.y =
        body.spec.locked > 0.5 && body.spec.kind === "terrain"
          ? Math.atan2(-x, y)
          : body.spinStart + seconds * SPIN_RATE * body.spin;
      const moon = body.spec.moon;
      if (body.moon && moon) {
        const angle = moon.phase + (seconds / moon.period) * 2 * Math.PI;
        const reach = layout.size * moon.distance;
        body.moon.position.set(Math.cos(angle) * reach, 0, Math.sin(angle) * reach);
      }
      const focused = layout.index === this.focused;
      body.orbit.material.opacity = focused ? 0.7 : 0.3;
      body.ball.material.uniforms.uTime.value = seconds;
      for (const [name, value] of Object.entries(stormUniforms(body.spec, seconds))) body.ball.material.uniforms[name].value = value;
      body.ball.material.uniforms.uDetail.value = focused ? 1 : 0;
    }
  }

  /** Advances the system by `dt` seconds. `seconds` is the animation time, which keeps running while the orbits are paused. */
  update(dt: number, seconds: number, viewport: Viewport): void {
    // Planets close to their star orbit very fast, so while the camera follows one, time slows down
    // until an orbit takes at least FOLLOWED_PERIOD seconds.
    const followed = this.focusedBody();
    const calm = followed ? Math.min(1, followed.layout.period / FOLLOWED_PERIOD) : 1;
    this.rate += (calm - this.rate) * (1 - Math.exp(-dt * 3));
    if (!this.paused) this.clock += dt * this.rate;

    const angleBefore = followed ? Math.atan2(followed.anchor.position.z, followed.anchor.position.x) : 0;
    this.placeBodies(seconds);
    if (followed) {
      // The camera turns with the planet around the star so that its day side stays in view.
      const angle = Math.atan2(followed.anchor.position.z, followed.anchor.position.x);
      this.azimuth += wrapAngle(angle - angleBefore);
    }

    const aspect = viewport.width / viewport.height;
    if (!this.fitted) {
      this.fitted = true;
      this.distanceGoal = this.focusedBody() ? this.distanceGoal : this.overviewDistance(aspect);
      this.distance = this.distanceGoal * 1.25;
    }
    this.distance += (this.distanceGoal - this.distance) * (1 - Math.exp(-dt * 4.5));
    this.lag.multiplyScalar(Math.exp(-dt * 4.5));
    this.swing *= Math.exp(-dt * 4.5);
    this.focusPoint(this.target).add(this.lag);

    const cos = Math.cos(this.elevation);
    const azimuth = this.azimuth + this.swing;
    this.camera.aspect = aspect;
    this.camera.near = this.distance * 0.02;
    this.camera.far = this.distance + this.extent * 12;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(
      this.target.x + this.distance * cos * Math.cos(azimuth),
      this.target.y + this.distance * Math.sin(this.elevation),
      this.target.z + this.distance * cos * Math.sin(azimuth),
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    this.glow.quaternion.copy(this.camera.quaternion);
    this.scene.updateMatrixWorld();

    // Each shader works in its object's local space, so the light and camera positions are converted.
    const origin = new Vector3();
    const place = (object: Mesh<BufferGeometry, RawShaderMaterial>) => {
      const { uLightObject, uCameraObject } = object.material.uniforms;
      if (uLightObject) object.worldToLocal((uLightObject.value as Vector3).copy(origin));
      if (uCameraObject) object.worldToLocal((uCameraObject.value as Vector3).copy(this.camera.position));
    };
    for (const body of this.bodies) {
      place(body.ball);
      if (body.ring) place(body.ring);
      if (body.haze) place(body.haze);
      if (body.moon) place(body.moon);
    }
    place(this.star);
    this.star.material.uniforms.uTime.value = seconds;
  }

  /** Returns a sphere's screen centre and radius in CSS pixels, or null if it is behind the camera. */
  private project(position: Vector3, radius: number, viewport: Viewport): [number, number, number] | null {
    const point = this.scratch.copy(position).project(this.camera);
    if (point.z > 1 || point.z < -1) return null;
    const pixelsPerUnit = viewport.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    return [
      (point.x * 0.5 + 0.5) * viewport.width,
      (0.5 - point.y * 0.5) * viewport.height,
      (radius * pixelsPerUnit) / position.distanceTo(this.camera.position),
    ];
  }

  /** Returns the planet or star under the point (x, y) in CSS pixels, if any. */
  pick(x: number, y: number, viewport: Viewport): SystemHit | null {
    let best: SystemHit | null = null;
    let bestOffset = Infinity;
    for (const body of this.bodies) {
      const point = this.project(body.anchor.position, body.layout.size, viewport);
      if (!point) continue;
      const offset = Math.hypot(point[0] - x, point[1] - y);
      if (offset < Math.max(point[2], 14) && offset < bestOffset) {
        bestOffset = offset;
        best = { kind: "planet", index: body.layout.index };
      }
    }
    if (best) return best;
    const star = this.project(this.star.position, this.starRadius, viewport);
    if (star && Math.hypot(star[0] - x, star[1] - y) < Math.max(star[2], 14)) return { kind: "star" };
    return null;
  }

  drawLabels(labels: LabelLayer, viewport: Viewport): void {
    const star = this.project(this.star.position, this.starRadius, viewport);
    if (star) labels.put(this.payload.star.name, star[0], star[1], "plain", star[2] + 8);
    for (const body of this.bodies) {
      if (!body.anchor.visible) continue;
      const point = this.project(body.anchor.position, body.layout.size, viewport);
      if (!point) continue;
      const focused = body.layout.index === this.focused;
      const reach = body.ring ? point[2] * 2.3 : point[2];
      labels.put(body.name, point[0], point[1], focused ? "strong" : "plain", reach + 7);
    }
  }

  dispose(): void {
    for (const body of this.bodies) {
      body.ball.material.dispose();
      body.ring?.geometry.dispose();
      body.ring?.material.dispose();
      body.haze?.material.dispose();
      body.moon?.material.dispose();
      body.orbit.geometry.dispose();
      body.orbit.material.dispose();
    }
    this.star.material.dispose();
    this.glow.geometry.dispose();
    this.glow.material.dispose();
    this.ballGeometry.dispose();
    this.sky.dispose();
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** Normalises an angle to the range -π to π. */
function wrapAngle(angle: number): number {
  const turn = 2 * Math.PI;
  return ((((angle + Math.PI) % turn) + turn) % turn) - Math.PI;
}

/** Returns a stable 32-bit hash of a string (FNV-1a). */
function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
