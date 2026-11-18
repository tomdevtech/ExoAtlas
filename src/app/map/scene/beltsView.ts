import {
  BufferAttribute,
  CustomBlending,
  GLSL3,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  OneFactor,
  RawShaderMaterial,
  Sphere,
  Vector2,
  Vector3,
} from "three";
import { solarSystemBelts, type BeltOptions } from "../belts";
import { viewRadius, type OrbitLayout } from "../orbits";
import { BELT_FRAGMENT, BELT_KNOTS, BELT_VERTEX } from "./shaders";

/**
 * The asteroid belt, the Kuiper belt and the Oort cloud as one cloud of small quads, drawn in a single
 * instanced call. The GPU moves every body along its orbit, so the CPU does no work per frame.
 */
export class BeltsView {
  readonly mesh: Mesh<InstancedBufferGeometry, RawShaderMaterial>;

  /** `layouts` are the solar system's orbits from the inside out, which set the compressed distances. */
  constructor(layouts: OrbitLayout[], options: BeltOptions) {
    const belts = solarSystemBelts(options);
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute("corner", new BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute("orbit", new InstancedBufferAttribute(belts.orbit, 4));
    const { toPeriapsis, ahead } = orbitAxes(belts.plane, belts.count);
    geometry.setAttribute("toPeriapsis", new InstancedBufferAttribute(toPeriapsis, 3));
    geometry.setAttribute("ahead", new InstancedBufferAttribute(ahead, 3));
    geometry.setAttribute("color", new InstancedBufferAttribute(belts.color, 3));
    geometry.instanceCount = belts.count;
    // The bodies move on the GPU, so three.js cannot measure them. The bounds reach to the Oort cloud's
    // outer edge so that frustum culling never drops the belts.
    geometry.boundingSphere = new Sphere(new Vector3(), viewRadius(layouts, 100000) * 1.05);

    const knots = layouts.slice(0, BELT_KNOTS);
    const pad = (values: number[]) => [...values, ...new Array<number>(BELT_KNOTS - values.length).fill(1)];
    this.mesh = new Mesh(
      geometry,
      new RawShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: BELT_VERTEX,
        fragmentShader: BELT_FRAGMENT,
        uniforms: {
          uClock: { value: 0 },
          uResolution: { value: new Vector2(1, 1) },
          uPixelRatio: { value: 1 },
          uKnotAu: { value: pad(knots.map((layout) => layout.axisAu)) },
          uKnotView: { value: pad(knots.map((layout) => layout.semiMajor)) },
          uKnots: { value: knots.length },
        },
        transparent: true,
        depthWrite: false,
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneFactor,
      }),
    );
  }

  /**
   * `clock` is the orbit clock of the system view, so the belts move, pause and slow down with the
   * planets. The viewport sets the size of the drawing buffer, in which the quads are measured.
   */
  update(clock: number, viewport: { width: number; height: number; pixelRatio: number }): void {
    const { uniforms } = this.mesh.material;
    uniforms.uClock.value = clock;
    uniforms.uPixelRatio.value = viewport.pixelRatio;
    (uniforms.uResolution.value as Vector2).set(viewport.width * viewport.pixelRatio, viewport.height * viewport.pixelRatio);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/**
 * Turns inclination, ascending node and argument of periapsis into the two unit vectors that span each
 * orbit, already in the view's axes (x, height as y, and the ecliptic's y as -z). The angles never change,
 * so this is done once here instead of four times per body and frame in the shader.
 */
export function orbitAxes(plane: Float32Array, count: number): { toPeriapsis: Float32Array; ahead: Float32Array } {
  const toPeriapsis = new Float32Array(count * 3);
  const ahead = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const [inclination, node, periapsis] = plane.subarray(i * 3, i * 3 + 3);
    const ci = Math.cos(inclination);
    const si = Math.sin(inclination);
    const cn = Math.cos(node);
    const sn = Math.sin(node);
    const cw = Math.cos(periapsis);
    const sw = Math.sin(periapsis);
    // The perifocal vectors P and Q in ecliptic coordinates, as in any text on orbital elements.
    const p = [cn * cw - sn * sw * ci, sn * cw + cn * sw * ci, sw * si];
    const q = [-cn * sw - sn * cw * ci, -sn * sw + cn * cw * ci, cw * si];
    toPeriapsis.set([p[0], p[2], -p[1]], i * 3);
    ahead.set([q[0], q[2], -q[1]], i * 3);
  }
  return { toPeriapsis, ahead };
}
