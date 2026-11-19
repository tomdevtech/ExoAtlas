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
  type WebGLRenderer,
} from "three";
import { NOISE_SIZE, noiseVolume } from "@/app/planets/globe/noise";
import { inventedBody, loadShapeGrid, SHAPE_FRAGMENT, SHAPE_VERTEX, shapeMesh, type ShapeMesh } from "@/app/planets/globe/shape";
import { linearColor, seedOffset, type GlobeSpec } from "@/app/planets/globe/spec";
import { stormUniforms } from "@/app/planets/globe/storms";
import { surfaceDefines, surfaceUniforms, textureUrls } from "@/app/planets/globe/uniforms";
import { starColor } from "../galaxy";
import {
  compressedMoonDistance,
  layoutMoons,
  layoutOrbits,
  orbitPoint,
  starSize,
  TRUE_AU,
  trueStarSize,
  type MoonLayout,
  type OrbitLayout,
} from "../orbits";
import type { MapShape, MapSystemPayload } from "../payload";
import { BeltsView } from "./beltsView";
import { HazeLayer, OCCLUDER_LAYER } from "./hazeLayer";
import { OrbitTrace } from "./orbitTrace";
import { smallMoonRadius, SmallMoonsView } from "./smallMoonsView";
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

/** What planets and moons have in common: a globe drawn with the shader of the detail pages, and its orbit. */
interface Globe {
  name: string;
  spec: GlobeSpec;
  /** Whether the high-resolution maps have been requested (see `sharpen`). */
  sharp: boolean;
  /** The group that moves along the orbit. It stays hidden until the maps have loaded. */
  anchor: Group;
  /** The tilted axis, scaled to the globe's radius in view units. Everything in it is measured in radii. */
  axis: Group;
  /** The globe mesh, which spins around the tilted axis: a sphere, or the shape of an irregular body. */
  ball: Mesh<BufferGeometry, RawShaderMaterial>;
  /** Whether the globe is drawn from a shape model, with its own geometry and the shader of shape.ts. */
  shaped: boolean;
  /**
   * The radius grid of a shape model once it has loaded. On the map the body is drawn from every
   * COARSE_SHAPE-th point of it, and `sharpen` rebuilds it in full when the camera follows it.
   */
  outline: { grid: Uint16Array | null; maxRadius: number; fine: boolean } | null;
  /** Whether the body tumbles instead of keeping one face to its planet. */
  tumbling: boolean;
  haze: Mesh<SphereGeometry, RawShaderMaterial> | null;
  /** The orbit, built with a semi-major axis of 1 and scaled to the current one. */
  orbit: Line<BufferGeometry, LineBasicMaterial>;
  /** The radius in view units at the current mix of scales, before the floor of a few pixels. */
  size: number;
  /** The semi-major axis in view units at the current mix of scales. */
  semiMajor: number;
}

interface Body extends Globe {
  layout: OrbitLayout;
  ring: Mesh<RingGeometry, RawShaderMaterial> | null;
  /** The illustrated moon of an exoplanet, which belongs to its look. */
  moon: Mesh<SphereGeometry, RawShaderMaterial> | null;
  /** The real moons, created the first time the camera follows the planet, so that their maps load only then. */
  moons: Moon[] | null;
  /** The small moons as points, created with the large ones. */
  smallMoons: SmallMoonsView | null;
  /** 1 when shown, falling to 0 while another planet's moon system takes the stage. */
  presence: number;
  spin: number;
  spinStart: number;
}

interface Moon extends Globe {
  layout: MoonLayout;
  /** The plane of the orbit, which is shown only while the camera follows the planet. */
  plane: Group;
}

export type SystemHit =
  | { kind: "planet"; index: number }
  | { kind: "moon"; planet: number; moon: number }
  | { kind: "star" };


const SPIN_RATE = (Math.PI * 2) / 40;
const ORBIT_SEGMENTS = 256;
const ORBIT_COLOR = 0x8fa3c8;
const SUN_MAP = "/textures/planets/sun-lg.jpg";
/** The angle in radians between the planet–star line and the camera direction when a planet is first followed. */
const DAYLIGHT_OFFSET = 0.9;
/** While the camera follows a planet, time slows so that one orbit takes at least this many seconds. */
const FOLLOWED_PERIOD = 90;
/** The smallest radius in CSS pixels a planet or moon is drawn with, so that the true scale does not lose it. */
const MIN_PIXELS = 1.6;
/** Shape models on the map use every fourth point of their grids: about 4,000 triangles instead of 65,000. */
const COARSE_SHAPE = 4;
/** The seconds a change between the compressed and the true scale takes. */
const SCALE_SECONDS = 1.8;
/** How fast other planets give way to a moon system, and the belts fade, per second. */
const FADE_RATE = 3;
/** How far beyond the outermost orbit the camera may go back, also in the true scale for the Oort cloud. */
const FARTHEST = 9;
const OORT_EDGE_AU = 100000;

/** Mixes two positive values by their logarithms, so a change across many powers of ten looks even. */
function mixLog(a: number, b: number, share: number): number {
  return a * (b / a) ** share;
}

/**
 * Renders one star with its planets on their orbits, in a compressed or the true scale (see orbits.ts),
 * with the orbits in the plane y = 0. The planets and moons use the same shader as the 3D model on their
 * detail pages. Following a planet that has moons gives the stage to its moon system: the other planets,
 * the orbits around the star and the belts fade out and are neither drawn nor updated, and the camera stays
 * within the moon system. The moons follow the scale like everything else.
 */
export class SystemView {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(45, 1, 0.02, 4000);

  /** The payload index of the planet the camera follows, or null when showing the whole system. */
  focused: number | null = null;
  /**
   * The moon the camera follows, if any: an index into the followed planet's large moons, or past them into
   * its small moons.
   */
  focusedMoon: number | null = null;
  paused = false;

  private readonly bodies: Body[] = [];
  private readonly belts: BeltsView | null = null;
  private readonly star: Mesh<SphereGeometry, RawShaderMaterial>;
  private readonly glow: Mesh<PlaneGeometry, RawShaderMaterial>;
  private readonly sky: Sky;
  private readonly ballGeometry = new SphereGeometry(1, 96, 48);
  private readonly starSizes: [compressed: number, real: number];
  /** The radius of the largest orbit in either scale, used to fit the overview. */
  private readonly extents: [compressed: number, real: number];

  /** Whether the moons are shown. Hidden moons are neither created, drawn nor updated. */
  private moonsShown = true;
  /** 0 for the compressed scale and 1 for the true one; `scaleGoal` is where it is heading. */
  private scaleProgress = 0;
  private scaleGoal = 0;
  /** How far the followed planet's moon system has taken the stage, from 0 to 1. */
  private stage = 0;
  private clock = 0;
  /** Moons keep their own pace, so that they do not crawl while time slows down for a followed planet. */
  private moonClock = 0;
  /** The animation time of the last frame, so that a change of focus can place the moons at once. */
  private lastSeconds = 0;
  /** The orbit speed factor, which is 1 normally and lower while the camera follows a fast planet. */
  private rate = 1;
  private azimuth = 0.6;
  /** The remaining rotation from the previous view direction, which decays so that focus changes glide. */
  private swing = 0;
  private elevation = 0.48;
  /**
   * The camera distance as a multiple of what it looks at: the radius of the followed planet or moon, or
   * the extent of the system. Changing the scale then keeps the picture, although sizes change a
   * thousandfold. `zoom` glides towards `zoomGoal` by its logarithm.
   */
  private zoom = 3;
  private zoomGoal = 3;
  private fitted = false;
  private readonly target = new Vector3();
  /** The remaining offset from the previous target, which decays so that focus changes glide. */
  private readonly lag = new Vector3();
  private readonly scratch = new Vector3();
  /**
   * The small moon the camera follows. Nobody has seen these close up, so it gets a made-up shape and surface
   * from its name (`inventedBody`), which the list calls an illustration. Created the first time one is
   * followed, and given a new shape whenever another one is.
   */
  private smallGlobe: Mesh<BufferGeometry, RawShaderMaterial> | null = null;
  private smallGlobeName: string | null = null;
  /** The followed small moon's radius in view units, before the floor of a few pixels. */
  private smallSize = 1;
  private readonly spot = new Vector3();
  /** The orbits of the followed planet and of the followed moon, traced around them every frame. */
  private readonly planetTrace = new OrbitTrace(ORBIT_COLOR);
  private readonly moonTrace = new OrbitTrace(ORBIT_COLOR);
  private readonly haze = new HazeLayer();

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

    this.starSizes = [starSize(star.radiusSun), trueStarSize(star.radiusSun)];
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
    this.star.layers.enable(OCCLUDER_LAYER);
    this.scene.add(this.star, this.planetTrace.line, this.moonTrace.line);

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
    this.scene.add(this.glow);

    const layouts = layoutOrbits(planets, star, seed);
    for (const layout of layouts) {
      this.bodies.push(this.createBody(layout));
    }
    this.extents = [
      layouts.reduce((extent, layout) => Math.max(extent, layout.semiMajor * (1 + layout.eccentricity)), this.starSizes[0] * 3),
      layouts.reduce(
        (extent, layout) => Math.max(extent, layout.axisAu * TRUE_AU * (1 + layout.eccentricity)),
        this.starSizes[1] * 3,
      ),
    ];
    const jupiter = layouts.find((layout) => planets[layout.index].slug === "jupiter");
    if (star.isSun && jupiter) {
      this.belts = new BeltsView(layouts, {
        jupiterLongitude: jupiter.periapsis + jupiter.phase,
        jupiterPeriod: jupiter.period,
        seed,
      });
      this.scene.add(this.belts.mesh);
    }
    this.placeBodies(0);
  }

  /** 0 for the compressed scale, 1 for the true one, eased while it changes. */
  private get trueScale(): number {
    const t = this.scaleProgress;
    return t * t * (3 - 2 * t);
  }

  private get extent(): number {
    return mixLog(this.extents[0], this.extents[1], this.trueScale);
  }

  private get starRadius(): number {
    return mixLog(this.starSizes[0], this.starSizes[1], this.trueScale);
  }

  /**
   * Builds the globe of a planet or moon, with its haze and an orbit line of semi-major axis 1. The globe
   * stays hidden until its maps have loaded so that it does not flash black; a map that fails to load also
   * counts as done, so it never stays hidden for ever. The caller adds its own parts to `axis` and then
   * calls `ready`.
   */
  private createGlobe(
    name: string,
    spec: GlobeSpec,
    orbit: { eccentricity: number; periapsis: number },
    shape: MapShape | null = null,
  ): Globe & { uniforms: Record<string, IUniform>; ready: () => void } {
    const { textures } = this;
    // On its orbit a globe is only a few dozen pixels wide, so the small maps are enough until the
    // camera follows it (see `sharpen`).
    const urls: { day: string | null; night: string | null; clouds: string | null; ring: string | null } = textureUrls(spec, "sm");
    // An irregular body without a map is drawn in its colour; asking for its map would only fail.
    if (shape && !shape.map) urls.day = null;

    const anchor = new Group();
    const axis = new Group();
    axis.rotation.z = (-spec.tiltDeg * Math.PI) / 180;
    anchor.add(axis);

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
    let ball: Globe["ball"];
    let outline: Globe["outline"] = null;
    if (shape) {
      const loading: NonNullable<Globe["outline"]> = { grid: null, maxRadius: shape.maxRadius, fine: false };
      outline = loading;
      // An irregular body keeps the uniforms the planets' updates set, though its shader reads few of them.
      uniforms.uHasMap = { value: shape.map ? 1 : 0 };
      uniforms.uTint = { value: linearColor(spec.palette[1]) };
      uniforms.uLight = { value: linearColor(spec.light) };
      ball = new Mesh(
        new BufferGeometry(),
        new RawShaderMaterial({ glslVersion: GLSL3, vertexShader: SHAPE_VERTEX, fragmentShader: SHAPE_FRAGMENT, uniforms }),
      );
      // The globe stays hidden until its shape has loaded too.
      pending++;
      loadShapeGrid(shape.url)
        .then((grid) => {
          loading.grid = grid;
          ball.geometry.dispose();
          ball.geometry = shapeGeometry(shapeMesh(grid, shape.maxRadius, loading.fine ? 1 : COARSE_SHAPE));
        })
        .catch((error) => console.warn(`The shape of ${name} could not be loaded.`, error))
        .finally(loaded);
    } else {
      for (const [key, value] of Object.entries({ ...surfaceUniforms(spec), ...stormUniforms(spec, 0) })) uniforms[key] = { value };
      ball = new Mesh(
        this.ballGeometry,
        new RawShaderMaterial({
          glslVersion: GLSL3,
          vertexShader: BALL_VERTEX,
          fragmentShader: PLANET_FRAGMENT,
          // The defines ensure that only the shader code this globe needs is compiled.
          defines: { ...surfaceDefines(spec) },
          uniforms,
        }),
      );
    }
    // Fast-spinning giants are flattened at the poles.
    ball.scale.set(1, 1 - spec.flattening, 1);
    axis.add(ball);

    let haze: Globe["haze"] = null;
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
      haze.scale.set(shell, shell * (1 - spec.flattening), shell);
      axis.add(haze);
    }

    // Globes hide the faint lines of the haze behind them.
    ball.layers.enable(OCCLUDER_LAYER);
    const points = new Float32Array((ORBIT_SEGMENTS + 1) * 3);
    for (let i = 0; i <= ORBIT_SEGMENTS; i++) {
      const [x, y] = orbitPoint(1, orbit.eccentricity, orbit.periapsis, (i / ORBIT_SEGMENTS) * 2 * Math.PI);
      points.set([x, 0, -y], i * 3);
    }
    const orbitGeometry = new BufferGeometry();
    orbitGeometry.setAttribute("position", new BufferAttribute(points, 3));
    const orbitLine = new Line(
      orbitGeometry,
      new LineBasicMaterial({ color: ORBIT_COLOR, transparent: true, opacity: 0.3, depthWrite: false }),
    );

    return {
      name,
      spec,
      // Without a map there is nothing sharper to load.
      sharp: shape !== null && !shape.map,
      anchor,
      axis,
      ball,
      haze,
      orbit: orbitLine,
      size: 1,
      semiMajor: 1,
      shaped: shape !== null,
      outline,
      tumbling: shape?.tumbling ?? false,
      uniforms,
      ready: loaded,
    };
  }

  private createBody(layout: OrbitLayout): Body {
    const planet = this.payload.planets[layout.index];
    const spec = planet.globe;
    const globe = this.createGlobe(planet.name, spec, layout, planet.shape);
    const { axis, ball, uniforms } = globe;

    let ring: Body["ring"] = null;
    if (spec.rings) {
      ring = new Mesh(
        new RingGeometry(spec.rings.inner, spec.rings.outer, 160, 1),
        new RawShaderMaterial({
          glslVersion: GLSL3,
          vertexShader: RING_VERTEX,
          fragmentShader: RING_FRAGMENT,
          defines: ball.material.defines,
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
      axis.add(ring);
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
      moon.scale.setScalar(spec.moon.size);
      // The moon is attached to the tilted axis so that its orbit lies in the planet's equatorial plane.
      axis.add(moon);
    }

    this.scene.add(globe.anchor, globe.orbit);
    globe.ready();
    return {
      ...globe,
      layout,
      ring,
      moon,
      moons: null,
      smallMoons: null,
      presence: 1,
      spin: spec.spin,
      spinStart: ((spec.seed * 0.618) % 1) * Math.PI * 2,
    };
  }

  /**
   * Creates the real moons of a planet. Each orbit lies in a plane tilted by the moon's inclination
   * against the planet's equator, or against the ecliptic for the Moon, and travels with the planet.
   */
  private createMoons(body: Body): Moon[] {
    const planet = this.payload.planets[body.layout.index];
    const layouts = layoutMoons(
      planet.moons,
      { radiusKm: (planet.radiusEarth ?? 1) * 6371, size: body.layout.size, reach: body.spec.rings?.outer ?? 1 },
      hashText(planet.slug),
    );
    return layouts.map((layout) => {
      const data = planet.moons[layout.index];
      const globe = this.createGlobe(data.name, data.globe, layout, data.shape);
      const plane = new Group();
      // With the order "YXZ" three.js tilts the orbit about x by the inclination first and then turns its
      // ascending node about the axis to a fixed but arbitrary direction.
      plane.rotation.set((data.inclinationDeg * Math.PI) / 180, scatterAngle(data.slug), 0, "YXZ");
      plane.add(globe.anchor, globe.orbit);
      plane.visible = false;
      const reference = new Group();
      if (!data.ecliptic) reference.rotation.z = (-body.spec.tiltDeg * Math.PI) / 180;
      reference.add(plane);
      body.anchor.add(reference);
      globe.ready();
      return { ...globe, layout, plane };
    });
  }

  /**
   * Replaces the small maps of a planet or moon with the large ones, each as soon as it has loaded, and
   * builds a shape model in full. This happens once, when the camera first follows it.
   */
  private sharpen(globe: Globe): void {
    const { outline } = globe;
    if (outline && !outline.fine) {
      // If the grid is still loading, it is built in full when it arrives.
      outline.fine = true;
      if (outline.grid) {
        globe.ball.geometry.dispose();
        globe.ball.geometry = shapeGeometry(shapeMesh(outline.grid, outline.maxRadius));
      }
    }
    if (globe.sharp) return;
    globe.sharp = true;
    const urls = textureUrls(globe.spec, "lg");
    // The rings share these uniforms with the planet, so they are updated as well.
    const { uniforms } = globe.ball.material;
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

  /** Switches between the compressed scale (false) and the true scale (true), gliding over. */
  setTrueScale(on: boolean, instantly = false): void {
    this.scaleGoal = on ? 1 : 0;
    if (instantly) this.scaleProgress = this.scaleGoal;
  }

  /** Shows or hides the moons. Hidden moons are neither drawn nor updated. */
  setMoonsShown(shown: boolean): void {
    this.moonsShown = shown;
    if (!shown && this.focusedMoon !== null) this.focus(this.focused, null);
  }

  /** Orbits the camera around its target. */
  drag(dx: number, dy: number): void {
    this.azimuth += dx * 0.005;
    this.elevation = clamp(this.elevation + dy * 0.005, -1.45, 1.45);
  }

  /** Moves the camera closer for positive amounts and away for negative ones. One mouse wheel notch is about 1. */
  push(amount: number): void {
    const [low, high] = this.zoomLimits();
    this.zoomGoal = clamp(this.zoomGoal * Math.exp(-amount * 0.2), low, high);
  }

  /** The closest and the farthest camera distance, as multiples of the reference length. */
  private zoomLimits(): [number, number] {
    const reference = this.reference();
    const closest = this.followedGlobe() || this.followedSmall() !== null ? 2.2 : (this.starRadius * 2.4) / reference;
    // Within a moon system the camera may go back to take in its outermost moon, but no farther, as the
    // rest of the system has made way.
    const body = this.moonStage() ? this.focusedBody() : null;
    if (body) {
      const small = this.payload.planets[body.layout.index].smallMoons;
      const radiusKm = (this.payload.planets[body.layout.index].radiusEarth ?? 1) * 6371;
      const knots = (body.moons ?? []).map((moon) => moon.layout).sort((a, b) => a.distance - b.distance);
      const outermost = Math.max(
        ...(body.moons ?? []).map((moon) => (moon.semiMajor / body.size) * (1 + moon.layout.eccentricity)),
        ...small.map(([, aKm, e]) => {
          const distance = (aKm / radiusKm) * (1 + e);
          return mixLog(compressedMoonDistance(knots, distance), distance, this.trueScale);
        }),
      );
      return [closest, Math.max(closest, (outermost * body.size * 3) / reference)];
    }
    // In the true scale the camera may go back far enough to take in the Oort cloud.
    const reach = this.belts ? mixLog(1, (OORT_EDGE_AU * TRUE_AU * 3) / (this.extents[1] * FARTHEST), this.trueScale) : 1;
    return [closest, (this.extent * FARTHEST * Math.max(1, reach)) / reference];
  }

  /** Follows a planet or one of its moons, or shows the whole system when `index` is null. */
  focus(index: number | null, moon: number | null = null): void {
    const before = this.focusPoint(new Vector3());
    const distance = this.zoom * this.reference();
    this.focused = index;
    const body = this.focusedBody();
    if (body && body.moons === null && this.moonsShown && this.hasMoons(body)) {
      body.moons = this.createMoons(body);
      const planet = this.payload.planets[body.layout.index];
      if (planet.smallMoons.length > 0) {
        body.smallMoons = new SmallMoonsView(
          planet.smallMoons,
          (planet.radiusEarth ?? 1) * 6371,
          body.spec.tiltDeg,
          body.moons.map((moon) => moon.layout).sort((a, b) => a.distance - b.distance),
        );
        body.anchor.add(body.smallMoons.group);
      }
    }
    const moonCount = body?.moons ? body.moons.length + this.payload.planets[body.layout.index].smallMoons.length : 0;
    this.focusedMoon = this.moonsShown && moon !== null && moon >= 0 && moon < moonCount ? moon : null;
    if (this.followedSmall() !== null) this.ensureSmallGlobe();
    this.measureSmall();
    // The moons must be in place before the new target is measured.
    this.placeBodies(this.lastSeconds);
    const followed = this.followedMoon();
    // The old target and distance are kept and decay, so the camera glides over instead of jumping.
    this.lag.add(before).sub(this.focusPoint(this.scratch));
    this.zoom = distance / this.reference();
    if (followed) this.sharpen(followed);
    if (body) {
      this.sharpen(body);
      // The camera looks from the star's side, slightly off the line to it, so that most of the planet
      // is in daylight and the star does not block the view.
      const turned = this.azimuth + this.swing;
      const { x, z } = body.anchor.position;
      this.azimuth = Math.atan2(-z, -x) + DAYLIGHT_OFFSET;
      this.swing = wrapAngle(turned - this.azimuth);
    }
    this.zoomGoal = followed || this.followedSmall() !== null ? 6.5 : body ? (body.ring ? 13 : 6.5) : this.overviewZoom(this.camera.aspect);
  }

  private focusedBody(): Body | null {
    return this.bodies.find((body) => body.layout.index === this.focused) ?? null;
  }

  private followedMoon(): Moon | null {
    const moons = this.focusedBody()?.moons;
    return moons && this.focusedMoon !== null && this.focusedMoon < moons.length ? moons[this.focusedMoon] : null;
  }

  /** The index into the followed planet's small moons of the one the camera follows, if any. */
  private followedSmall(): number | null {
    const moons = this.focusedBody()?.moons;
    return moons && this.focusedMoon !== null && this.focusedMoon >= moons.length ? this.focusedMoon - moons.length : null;
  }

  private followedGlobe(): Globe | null {
    return this.followedMoon() ?? this.focusedBody();
  }

  /** The length the camera distance is measured in: the radius of what it follows, or the extent of the system. */
  private reference(): number {
    if (this.followedSmall() !== null) return this.smallSize;
    return this.followedGlobe()?.size ?? this.extent;
  }

  /** Where the followed small moon is, in world space, or null if the camera follows none. */
  private smallPoint(out: Vector3): Vector3 | null {
    const index = this.followedSmall();
    const body = this.focusedBody();
    if (index === null || !body?.smallMoons) return null;
    body.smallMoons.place(index, this.moonClock, this.trueScale, out);
    body.anchor.updateWorldMatrix(true, false);
    return out.multiplyScalar(body.size).applyMatrix4(body.anchor.matrixWorld);
  }

  /** Sets the followed small moon's radius in view units at the current mix of scales. */
  private measureSmall(): void {
    const index = this.followedSmall();
    const body = this.focusedBody();
    if (index === null || !body) return;
    const planet = this.payload.planets[body.layout.index];
    const radiusKm = planet.smallMoons[index][8];
    this.smallSize = smallMoonRadius(radiusKm, (planet.radiusEarth ?? 1) * 6371, body.layout.size, this.trueScale) * body.size;
  }

  private ensureSmallGlobe(): void {
    const index = this.followedSmall();
    const body = this.focusedBody();
    if (index === null || !body) return;
    const name = this.payload.planets[body.layout.index].smallMoons[index][0];
    if (this.smallGlobe && this.smallGlobeName === name) return;
    this.smallGlobeName = name;
    const invented = inventedBody(hashText(name));
    const geometry = shapeGeometry(shapeMesh(invented.grid, invented.maxRadius));
    // The map is display colour like the real ones.
    const map = new DataTexture(invented.map, invented.mapWidth, invented.mapHeight);
    map.wrapS = RepeatWrapping;
    map.magFilter = LinearFilter;
    map.minFilter = LinearFilter;
    map.needsUpdate = true;
    if (this.smallGlobe) {
      this.smallGlobe.geometry.dispose();
      (this.smallGlobe.material.uniforms.uMapDay.value as Texture).dispose();
      this.smallGlobe.geometry = geometry;
      this.smallGlobe.material.uniforms.uMapDay.value = map;
      return;
    }
    this.smallGlobe = new Mesh(
      geometry,
      new RawShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: SHAPE_VERTEX,
        fragmentShader: SHAPE_FRAGMENT,
        uniforms: {
          uMapDay: { value: map },
          uHasMap: { value: 1 },
          uTint: { value: [0, 0, 0] },
          uLight: { value: [1, 1, 1] },
          uLightObject: { value: new Vector3() },
          uCameraObject: { value: new Vector3() },
        },
      }),
    );
    this.smallGlobe.visible = false;
    this.smallGlobe.layers.enable(OCCLUDER_LAYER);
    this.scene.add(this.smallGlobe);
  }

  private focusPoint(out: Vector3): Vector3 {
    const small = this.smallPoint(out);
    if (small) return small;
    const moon = this.followedMoon();
    if (moon) return moon.anchor.getWorldPosition(out);
    const body = this.focusedBody();
    return body ? out.copy(body.anchor.position) : out.set(0, 0, 0);
  }

  /** Returns the camera distance, in extents, at which the whole system fits on the screen. */
  private overviewZoom(aspect: number): number {
    return 2.7 * Math.max(1, 1 / aspect);
  }

  private hasMoons(body: Body): boolean {
    const planet = this.payload.planets[body.layout.index];
    return planet.moons.length + planet.smallMoons.length > 0;
  }

  /** Whether the followed planet's moons are on stage, which makes the other planets give way. */
  private moonStage(): boolean {
    const body = this.focusedBody();
    return this.moonsShown && body !== null && this.hasMoons(body);
  }

  /** Positions every planet and moon on its orbit at the current mix of scales and updates its rotation and shader time. */
  private placeBodies(seconds: number): void {
    this.lastSeconds = seconds;
    const scale = this.trueScale;
    for (const body of this.bodies) {
      const { layout } = body;
      body.semiMajor = mixLog(layout.semiMajor, layout.axisAu * TRUE_AU, scale);
      body.size = mixLog(layout.size, layout.trueSize, scale);
      const focused = layout.index === this.focused;
      body.presence = focused ? 1 : 1 - this.stage;
      // The planet's own orbit around the star gives way too. In the true scale a trace of it may stay, as
      // it really passes through the moon system; in the compressed scale it would cut across it at random.
      const orbitPresence = focused ? 1 - this.stage * (1 - 0.15 * scale) : body.presence;
      const [x, y] = orbitPoint(
        body.semiMajor,
        layout.eccentricity,
        layout.periapsis,
        layout.phase + (this.clock / layout.period) * 2 * Math.PI,
      );
      body.anchor.position.set(x, 0, -y);
      body.orbit.scale.setScalar(body.semiMajor);
      body.orbit.material.opacity = (focused ? 0.7 : 0.3) * orbitPresence;
      body.orbit.visible = orbitPresence > 0.002;
      body.axis.visible = body.presence > 0.002;
      if (body.moons) this.placeMoons(body, focused, seconds);
      // A planet that has given way is neither drawn nor updated until it comes back.
      if (!body.axis.visible) continue;
      // A tidally locked rocky planet rotates once per orbit. All other planets spin at their own pace,
      // including locked gas giants, whose winds carry the clouds around.
      body.ball.rotation.y =
        body.spec.locked > 0.5 && body.spec.kind === "terrain"
          ? Math.atan2(-x, y)
          : body.spinStart + seconds * SPIN_RATE * body.spin;
      const moon = body.spec.moon;
      if (body.moon && moon) {
        const angle = moon.phase + (seconds / moon.period) * 2 * Math.PI;
        body.moon.position.set(Math.cos(angle) * moon.distance, 0, Math.sin(angle) * moon.distance);
      }
      body.ball.material.uniforms.uTime.value = seconds;
      if (!body.shaped) {
        for (const [name, value] of Object.entries(stormUniforms(body.spec, seconds))) body.ball.material.uniforms[name].value = value;
      }
      body.ball.material.uniforms.uDetail.value = focused && this.focusedMoon === null ? 1 : 0;
    }
  }

  /**
   * Moves the moons along their orbits, at their true distances in radii of the planet. They show only
   * while the camera follows their planet, growing in as the rest of the system makes way.
   */
  private placeMoons(body: Body, focused: boolean, seconds: number): void {
    const shown = focused && this.moonsShown && this.stage > 0.002;
    (body.moons ?? []).forEach((moon, index) => {
      moon.plane.visible = shown;
      // The place is kept up to date while hidden, because following a moon measures from it at once.
      const { layout } = moon;
      moon.semiMajor = mixLog(layout.compressedDistance, layout.distance, this.trueScale) * body.size;
      moon.size = mixLog(layout.compressedSize, layout.size, this.trueScale) * body.size;
      const [x, y] = orbitPoint(
        moon.semiMajor,
        layout.eccentricity,
        layout.periapsis,
        layout.phase + (this.moonClock / layout.period) * 2 * Math.PI,
      );
      moon.anchor.position.set(x, 0, -y);
      moon.orbit.scale.setScalar(moon.semiMajor);
      // The moons are tidally locked, and the middle of each map (longitude 0) faces the planet. The
      // shader puts that longitude on +z, which this turns towards the planet at the origin. A tumbling
      // moon turns about all three axes at unrelated rates instead.
      if (moon.tumbling) moon.ball.rotation.set(seconds * 0.23, seconds * 0.17, seconds * 0.11);
      else moon.ball.rotation.y = Math.atan2(-x, y);
      const followed = index === this.focusedMoon;
      moon.orbit.material.opacity = (followed ? 0.6 : 0.25) * this.stage;
      moon.ball.material.uniforms.uTime.value = seconds;
      moon.ball.material.uniforms.uDetail.value = followed ? 1 : 0;
    });
  }

  /** Sets the drawn radius of a globe: its size, but never less than MIN_PIXELS on screen, times `presence`. */
  private sizeOnScreen(globe: Globe, pixelsPerUnit: number, presence: number): void {
    const away = globe.anchor.getWorldPosition(this.spot).distanceTo(this.camera.position);
    globe.axis.scale.setScalar(Math.max(globe.size, (MIN_PIXELS * away) / pixelsPerUnit) * Math.max(presence, 1e-4));
  }

  /** Advances the system by `dt` seconds. `seconds` is the animation time, which keeps running while the orbits are paused. */
  update(dt: number, seconds: number, viewport: Viewport): void {
    // Planets close to their star orbit very fast, so while the camera follows one, time slows down
    // until an orbit takes at least FOLLOWED_PERIOD seconds.
    const followed = this.focusedBody();
    const calm = followed ? Math.min(1, followed.layout.period / FOLLOWED_PERIOD) : 1;
    this.rate += (calm - this.rate) * (1 - Math.exp(-dt * 3));
    if (!this.paused) {
      this.clock += dt * this.rate;
      this.moonClock += dt;
    }
    this.scaleProgress = approach(this.scaleProgress, this.scaleGoal, dt / SCALE_SECONDS);
    this.stage = approach(this.stage, this.moonStage() ? 1 : 0, dt * FADE_RATE);

    const angleBefore = followed ? Math.atan2(followed.anchor.position.z, followed.anchor.position.x) : 0;
    this.placeBodies(seconds);
    this.measureSmall();
    if (followed) {
      // The camera turns with the planet around the star so that its day side stays in view.
      const angle = Math.atan2(followed.anchor.position.z, followed.anchor.position.x);
      this.azimuth += wrapAngle(angle - angleBefore);
    }

    const aspect = viewport.width / viewport.height;
    if (!this.fitted) {
      this.fitted = true;
      if (!this.followedGlobe()) this.zoomGoal = this.overviewZoom(aspect);
      this.zoom = this.zoomGoal * 1.25;
    }
    const [low, high] = this.zoomLimits();
    this.zoomGoal = clamp(this.zoomGoal, low, high);
    this.zoom *= (this.zoomGoal / this.zoom) ** (1 - Math.exp(-dt * 4.5));
    this.lag.multiplyScalar(Math.exp(-dt * 4.5));
    this.swing *= Math.exp(-dt * 4.5);
    this.focusPoint(this.target).add(this.lag);

    const distance = this.zoom * this.reference();
    const cos = Math.cos(this.elevation);
    const azimuth = this.azimuth + this.swing;
    this.camera.aspect = aspect;
    this.camera.near = distance * 0.02;
    this.camera.far = distance * 2 + this.extent * 12;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(
      this.target.x + distance * cos * Math.cos(azimuth),
      this.target.y + distance * Math.sin(this.elevation),
      this.target.z + distance * cos * Math.sin(azimuth),
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();

    // Sizes depend on the camera, because nothing may shrink below a few pixels in the true scale.
    const pixelsPerUnit = viewport.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    const starAway = this.camera.position.length();
    const starDrawn = Math.max(this.starRadius, (MIN_PIXELS * 1.6 * starAway) / pixelsPerUnit);
    this.star.scale.setScalar(starDrawn);
    this.glow.scale.setScalar(starDrawn * 9);
    this.glow.quaternion.copy(this.camera.quaternion);
    if (this.smallGlobe) {
      const point = this.smallPoint(this.spot);
      this.smallGlobe.visible = point !== null && this.stage > 0.002;
      if (point) {
        this.smallGlobe.position.copy(point);
        const away = point.distanceTo(this.camera.position);
        this.smallGlobe.scale.setScalar(Math.max(this.smallSize, (MIN_PIXELS * away) / pixelsPerUnit) * Math.max(this.stage, 1e-4));
        // Small moons near their planet are locked like the large ones; one face is turned to it.
        const planet = this.focusedBody()!.anchor.position;
        this.smallGlobe.rotation.set(0, Math.atan2(planet.x - point.x, planet.z - point.z), 0);
      }
    }
    for (const body of this.bodies) {
      if (!body.axis.visible) continue;
      this.sizeOnScreen(body, pixelsPerUnit, body.presence);
      if (body.moons && body.layout.index === this.focused) {
        for (const moon of body.moons) if (moon.plane.visible) this.sizeOnScreen(moon, pixelsPerUnit, this.stage);
      }
    }
    this.scene.updateMatrixWorld();

    // Each shader works in its object's local space, so the light and camera positions are converted.
    const origin = new Vector3();
    const place = (object: Mesh<BufferGeometry, RawShaderMaterial>) => {
      const { uLightObject, uCameraObject } = object.material.uniforms;
      if (uLightObject) object.worldToLocal((uLightObject.value as Vector3).copy(origin));
      if (uCameraObject) object.worldToLocal((uCameraObject.value as Vector3).copy(this.camera.position));
    };
    for (const body of this.bodies) {
      if (!body.axis.visible) continue;
      place(body.ball);
      if (body.ring) place(body.ring);
      if (body.haze) place(body.haze);
      if (body.moon) place(body.moon);
      for (const moon of body.moons ?? []) {
        if (!moon.plane.visible) continue;
        place(moon.ball);
        if (moon.haze) place(moon.haze);
      }
    }
    if (this.smallGlobe?.visible) place(this.smallGlobe);
    place(this.star);
    this.star.material.uniforms.uTime.value = seconds;
    this.belts?.update(this.clock, viewport, this.trueScale, 1 - this.stage);
    for (const body of this.bodies) {
      const shown = body.layout.index === this.focused && this.moonsShown ? this.stage : 0;
      body.smallMoons?.update(this.moonClock, viewport, body.size, this.trueScale, shown);
    }
    this.traceOrbits();
  }

  /** Lays the haze of faint lines over the picture, if any are shown (see HazeLayer). */
  renderHaze(renderer: WebGLRenderer, viewport: Viewport): void {
    if (this.bodies.some((body) => body.smallMoons?.group.visible)) this.haze.render(renderer, this.scene, this.camera, viewport);
  }

  /**
   * Draws the orbits of the followed planet and moon as traces around them (see OrbitTrace) in place of
   * their fixed polygons, which miss them in the true scale.
   */
  private traceOrbits(): void {
    const body = this.focusedBody();
    if (body && body.orbit.visible) {
      body.orbit.visible = false;
      const { layout } = body;
      const anomaly = layout.phase + (this.clock / layout.period) * 2 * Math.PI;
      this.planetTrace.update((offset, out) => {
        const [x, y] = orbitPoint(body.semiMajor, layout.eccentricity, layout.periapsis, anomaly + offset);
        return out.set(x, 0, -y);
      }, body.orbit.material.opacity);
    } else {
      this.planetTrace.hide();
    }

    const moon = this.followedMoon();
    const small = this.followedSmall();
    for (const other of body?.moons ?? []) other.orbit.visible = other !== moon;
    if (moon?.plane.visible) {
      const { layout } = moon;
      const anomaly = layout.phase + (this.moonClock / layout.period) * 2 * Math.PI;
      this.moonTrace.update((offset, out) => {
        const [x, y] = orbitPoint(moon.semiMajor, layout.eccentricity, layout.periapsis, anomaly + offset);
        return out.set(x, 0, -y).applyMatrix4(moon.plane.matrixWorld);
      }, moon.orbit.material.opacity);
    } else if (body?.smallMoons && small !== null) {
      const view = body.smallMoons;
      const period = view.period(small);
      this.moonTrace.update(
        (offset, out) =>
          view
            .place(small, this.moonClock + (offset * period) / (2 * Math.PI), this.trueScale, out)
            .multiplyScalar(body.size)
            .applyMatrix4(body.anchor.matrixWorld),
        0.6 * this.stage,
      );
    } else {
      this.moonTrace.hide();
    }
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

  /** The moons that are shown, with their planet's payload index and their own index. */
  private shownMoons(): { moon: Moon; planet: number; index: number }[] {
    const body = this.focusedBody();
    if (!body?.moons || this.stage < 0.5) return [];
    return body.moons
      .map((moon, index) => ({ moon, planet: body.layout.index, index }))
      .filter(({ moon }) => moon.plane.visible && moon.anchor.visible);
  }

  /** The planets that are shown: not still loading, and not given way to a moon system. */
  private shownBodies(): Body[] {
    return this.bodies.filter((body) => body.anchor.visible && body.presence >= 0.5);
  }

  /** Returns the planet, moon or star under the point (x, y) in CSS pixels, if any. */
  pick(x: number, y: number, viewport: Viewport): SystemHit | null {
    let best: SystemHit | null = null;
    let bestOffset = Infinity;
    const consider = (position: Vector3, size: number, hit: SystemHit) => {
      const point = this.project(position, size, viewport);
      if (!point) return;
      const offset = Math.hypot(point[0] - x, point[1] - y);
      if (offset < Math.max(point[2], 14) && offset < bestOffset) {
        bestOffset = offset;
        best = hit;
      }
    };
    for (const body of this.shownBodies()) {
      consider(body.anchor.position, body.axis.scale.x, { kind: "planet", index: body.layout.index });
    }
    for (const { moon, planet, index } of this.shownMoons()) {
      consider(moon.anchor.getWorldPosition(this.spot), moon.axis.scale.x, { kind: "moon", planet, moon: index });
    }
    if (best) return best;
    const star = this.project(this.star.position, this.star.scale.x, viewport);
    if (star && Math.hypot(star[0] - x, star[1] - y) < Math.max(star[2], 14)) return { kind: "star" };
    return null;
  }

  drawLabels(labels: LabelLayer, viewport: Viewport): void {
    const star = this.project(this.star.position, this.star.scale.x, viewport);
    if (star) labels.put(this.payload.star.name, star[0], star[1], "plain", star[2] + 8);
    for (const body of this.shownBodies()) {
      const point = this.project(body.anchor.position, body.axis.scale.x, viewport);
      if (!point) continue;
      const strong = body.layout.index === this.focused && this.focusedMoon === null;
      const reach = body.ring ? point[2] * 2.3 : point[2];
      labels.put(body.name, point[0], point[1], strong ? "strong" : "plain", reach + 7);
    }
    for (const { moon, index } of this.shownMoons()) {
      const point = this.project(moon.anchor.getWorldPosition(this.spot), moon.axis.scale.x, viewport);
      if (point) labels.put(moon.name, point[0], point[1], index === this.focusedMoon ? "strong" : "plain", point[2] + 6);
    }
    const small = this.followedSmall();
    if (small !== null && this.smallGlobe?.visible) {
      const point = this.project(this.smallGlobe.position, this.smallGlobe.scale.x, viewport);
      const name = this.payload.planets[this.focusedBody()!.layout.index].smallMoons[small][0];
      if (point) labels.put(name, point[0], point[1], "strong", point[2] + 6);
    }
  }

  dispose(): void {
    for (const body of this.bodies) {
      for (const globe of [body, ...(body.moons ?? [])]) {
        globe.ball.material.dispose();
        if (globe.shaped) globe.ball.geometry.dispose();
        globe.haze?.material.dispose();
        globe.orbit.geometry.dispose();
        globe.orbit.material.dispose();
      }
      body.ring?.geometry.dispose();
      body.ring?.material.dispose();
      body.moon?.material.dispose();
      body.smallMoons?.dispose();
    }
    this.belts?.dispose();
    if (this.smallGlobe) {
      this.smallGlobe.geometry.dispose();
      (this.smallGlobe.material.uniforms.uMapDay.value as Texture).dispose();
      this.smallGlobe.material.dispose();
    }
    this.star.material.dispose();
    this.glow.geometry.dispose();
    this.glow.material.dispose();
    this.ballGeometry.dispose();
    this.sky.dispose();
    this.planetTrace.dispose();
    this.moonTrace.dispose();
    this.haze.dispose();
  }
}

function shapeGeometry(surface: ShapeMesh): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(surface.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(surface.normals, 3));
  geometry.setAttribute("direction", new BufferAttribute(surface.directions, 3));
  geometry.setIndex(new BufferAttribute(surface.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** Moves `value` towards `goal` by at most `step`. */
function approach(value: number, goal: number, step: number): number {
  return value < goal ? Math.min(goal, value + step) : Math.max(goal, value - step);
}

/** Normalises an angle to the range -π to π. */
function wrapAngle(angle: number): number {
  const turn = 2 * Math.PI;
  return ((((angle + Math.PI) % turn) + turn) % turn) - Math.PI;
}

/** Returns an angle from 0 to 2π that is always the same for the same text. */
function scatterAngle(text: string): number {
  return ((hashText(text) % 3600) / 3600) * 2 * Math.PI;
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
