import { BufferAttribute, BufferGeometry, Line, LineBasicMaterial, Vector3 } from "three";

export const TRACE_SEGMENTS = 512;

/**
 * Offsets in mean anomaly from the body, from -π to π, crowded near 0 and spreading towards the far side
 * of the orbit as the square of the distance along the line: the steps next to the body are a few
 * hundred-thousandths of a radian, those on the far side as long as on an evenly divided orbit of 256.
 */
export function traceOffsets(segments = TRACE_SEGMENTS): Float64Array {
  return Float64Array.from({ length: segments + 1 }, (_, k) => {
    const u = -1 + (2 * k) / segments;
    return Math.PI * u * Math.abs(u);
  });
}

/**
 * The orbit of a body the camera follows, traced afresh around it every frame. A fixed polygon of an
 * orbit misses the body between its corners: in the true scale Saturn's orbit, 9.5 AU across, strays
 * two radii of Saturn from it, and wobbles as Saturn moves on. This line has a corner on the body and
 * short steps near it, and is stored relative to it, so 32-bit vertices lose nothing close to the camera.
 */
export class OrbitTrace {
  readonly line: Line<BufferGeometry, LineBasicMaterial>;
  private readonly offsets = traceOffsets();
  private readonly positions = new Float32Array(this.offsets.length * 3);
  private readonly origin = new Vector3();
  private readonly point = new Vector3();

  constructor(color: number) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.positions, 3));
    this.line = new Line(geometry, new LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }));
    // The points change every frame, so bounds would have to be measured every frame as well.
    this.line.frustumCulled = false;
    this.line.visible = false;
  }

  /**
   * Traces the orbit through `at(offset, out)`, which writes the body's place in world space at an offset
   * in mean anomaly from where it is now.
   */
  update(at: (offset: number, out: Vector3) => Vector3, opacity: number): void {
    this.line.visible = opacity > 0.002;
    if (!this.line.visible) return;
    at(0, this.origin);
    this.offsets.forEach((offset, k) => {
      at(offset, this.point).sub(this.origin);
      this.positions.set([this.point.x, this.point.y, this.point.z], k * 3);
    });
    this.line.position.copy(this.origin);
    this.line.geometry.attributes.position.needsUpdate = true;
    this.line.material.opacity = opacity;
  }

  hide(): void {
    this.line.visible = false;
  }

  dispose(): void {
    this.line.geometry.dispose();
    this.line.material.dispose();
  }
}
