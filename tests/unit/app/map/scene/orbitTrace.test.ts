import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { orbitPoint } from "@/app/map/orbits";
import { hazeSize } from "@/app/map/scene/hazeLayer";
import { OrbitTrace, TRACE_SEGMENTS, traceOffsets } from "@/app/map/scene/orbitTrace";

describe("traceOffsets", () => {
  it("runs once round the orbit, with a corner on the body and short steps next to it", () => {
    const offsets = traceOffsets();
    expect(offsets).toHaveLength(TRACE_SEGMENTS + 1);
    expect(offsets[0]).toBeCloseTo(-Math.PI, 12);
    expect(offsets[TRACE_SEGMENTS]).toBeCloseTo(Math.PI, 12);
    expect(offsets[TRACE_SEGMENTS / 2]).toBe(0);
    const step = (k: number) => offsets[k + 1] - offsets[k];
    expect(step(TRACE_SEGMENTS / 2)).toBeLessThan(1e-4);
    // On the far side no coarser than an evenly divided orbit of 256.
    expect(step(0)).toBeLessThanOrEqual((2 * Math.PI) / 256 + 1e-12);
  });
});

describe("OrbitTrace", () => {
  // Saturn in the true scale: 9.5 AU out, its radius 0.0004 AU.
  const semiMajor = 9.54;
  const at = (anomaly: number) => (offset: number, out: Vector3) => {
    const [x, y] = orbitPoint(semiMajor, 0.054, 1.6, anomaly + offset);
    return out.set(x, 0, -y);
  };

  it("passes through the body and hugs its orbit near it, wherever the body is", () => {
    const trace = new OrbitTrace(0xffffff);
    for (const anomaly of [0.3, 0.3 + 0.006, 2.1]) {
      trace.update(at(anomaly), 0.5);
      const body = at(anomaly)(0, new Vector3());
      expect(trace.line.position.distanceTo(body)).toBe(0);
      const positions = trace.line.geometry.attributes.position.array;
      // The corner in the middle is the body itself.
      expect(Array.from(positions.slice((TRACE_SEGMENTS / 2) * 3, (TRACE_SEGMENTS / 2) * 3 + 3))).toEqual([0, 0, 0]);
      // Halfway along the steps next to the body the line strays far less than a radius of Saturn.
      const a = new Vector3().fromArray(positions, (TRACE_SEGMENTS / 2 + 1) * 3);
      const middle = a.multiplyScalar(0.5).add(body);
      const offsets = traceOffsets();
      const onOrbit = at(anomaly)(offsets[TRACE_SEGMENTS / 2 + 1] / 2, new Vector3());
      expect(middle.distanceTo(onOrbit)).toBeLessThan(0.0004 / 100);
    }
    expect(trace.line.material.opacity).toBe(0.5);
    trace.dispose();
  });

  it("hides when faded out", () => {
    const trace = new OrbitTrace(0xffffff);
    trace.update(at(1), 0.5);
    expect(trace.line.visible).toBe(true);
    trace.update(at(1), 0);
    expect(trace.line.visible).toBe(false);
    trace.update(at(1), 0.5);
    trace.hide();
    expect(trace.line.visible).toBe(false);
    trace.dispose();
  });
});

describe("hazeSize", () => {
  it("is half the drawing buffer, and never empty", () => {
    expect(hazeSize({ width: 1600, height: 900, pixelRatio: 1 })).toEqual([800, 450]);
    expect(hazeSize({ width: 1600, height: 900, pixelRatio: 2 })).toEqual([1600, 900]);
    expect(hazeSize({ width: 1, height: 1, pixelRatio: 1 })).toEqual([1, 1]);
  });
});
