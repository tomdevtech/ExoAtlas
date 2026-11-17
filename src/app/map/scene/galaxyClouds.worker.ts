import { galaxyClouds, type GalaxyClouds } from "../galaxyClouds";

/**
 * Generates the galaxy clouds off the main thread. Placing about 80,000 clouds takes a few hundred
 * milliseconds, which would otherwise freeze the map right after it opens.
 */

/** The message sent by the map: the galaxy picture as linear RGB, `size` × `size`. */
export interface CloudsRequest {
  rgb: Float32Array;
  size: number;
}

interface Scope {
  onmessage: ((event: MessageEvent<CloudsRequest>) => void) | null;
  postMessage(message: GalaxyClouds, transfer: Transferable[]): void;
}

const scope = self as unknown as Scope;

// There is no origin check because a dedicated worker only receives messages from the page that created it.
// Those messages carry an empty origin, so comparing it with location.origin would reject every message.
scope.onmessage = (event) => {
  const clouds = galaxyClouds(event.data.rgb, event.data.size);
  scope.postMessage(clouds, [clouds.light.buffer, clouds.dust.buffer, clouds.clusters.buffer]);
};
