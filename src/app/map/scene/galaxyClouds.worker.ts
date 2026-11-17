import { galaxyClouds, type GalaxyClouds } from "../galaxyClouds";

/**
 * Makes the clouds of the galaxy (galaxyClouds.ts) off the main thread.
 * Placing some eighty thousand clouds takes a few hundred milliseconds, and
 * on the main thread the map would stand still for that long just after it
 * opens. Here it costs the visitor nothing.
 */

/** What the map sends: the picture of the galaxy as linear red, green and blue, `size` × `size`. */
export interface CloudsRequest {
  rgb: Float32Array;
  size: number;
}

/** The part of a worker's own scope that is used here. */
interface Scope {
  onmessage: ((event: MessageEvent<CloudsRequest>) => void) | null;
  postMessage(message: GalaxyClouds, transfer: Transferable[]): void;
}

const scope = self as unknown as Scope;

scope.onmessage = (event) => {
  const clouds = galaxyClouds(event.data.rgb, event.data.size);
  // Handed over, not copied.
  scope.postMessage(clouds, [clouds.light.buffer, clouds.dust.buffer, clouds.clusters.buffer]);
};
