import { afterEach, describe, expect, it, vi } from "vitest";
import { galaxyClouds, type GalaxyClouds } from "@/app/map/galaxyClouds";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** Builds a small synthetic galaxy picture with a bright middle, a dimmer ring and black around it. */
function picture(size: number): Float32Array {
  const rgb = new Float32Array(size * size * 3);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const r = Math.hypot(column + 0.5 - size / 2, row + 0.5 - size / 2) / (size / 2);
      const value = r < 0.15 ? 0.6 : r < 0.6 ? 0.2 : 0;
      rgb.set([value, value * 0.9, value * 0.7], (row * size + column) * 3);
    }
  }
  return rgb;
}

describe("the worker of the galaxy clouds", () => {
  it("makes the clouds of the picture it is sent and hands them over without copying", async () => {
    const posted: { message: GalaxyClouds; transfer: Transferable[] }[] = [];
    const scope: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: (message: GalaxyClouds, transfer: Transferable[]) => void } = {
      onmessage: null,
      postMessage: (message, transfer) => posted.push({ message, transfer }),
    };
    vi.stubGlobal("self", scope);
    await import("@/app/map/scene/galaxyClouds.worker");
    expect(scope.onmessage).toBeTypeOf("function");

    const size = 32;
    scope.onmessage?.({ data: { rgb: picture(size), size } });
    expect(posted).toHaveLength(1);
    const [{ message, transfer }] = posted;
    // The worker must produce the same clouds as the page would compute itself.
    const expected = galaxyClouds(picture(size), size);
    expect(Array.from(message.light)).toEqual(Array.from(expected.light));
    expect(Array.from(message.dust)).toEqual(Array.from(expected.dust));
    expect(Array.from(message.clusters)).toEqual(Array.from(expected.clusters));
    // The buffers are transferred rather than copied, to avoid duplicating large arrays.
    expect(transfer).toEqual([message.light.buffer, message.dust.buffer, message.clusters.buffer]);
  });
});
