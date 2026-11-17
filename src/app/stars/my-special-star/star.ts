import { GALACTIC_CENTRE } from "@/app/map/galaxy";
import type { MapStar } from "@/app/map/payload";

/**
 * An easter egg: a star that is in no catalogue. It sits at the centre of the Milky Way and only exists in the
 * browser, so the NASA sync never touches it. Clicking it on the map opens its own page.
 */
export const SPECIAL_STAR_SLUG = "my-special-star";
export const SPECIAL_STAR_NAME = "My Special Star";

/** Its glow on the map is a warm rose instead of a temperature colour. */
export const SPECIAL_STAR_COLOR: readonly [number, number, number] = [1.0, 0.45, 0.72];

/** The star in the compact tuple form the map uses. It has no planets. */
export const SPECIAL_STAR: MapStar = [
  SPECIAL_STAR_SLUG,
  SPECIAL_STAR_NAME,
  GALACTIC_CENTRE[0],
  GALACTIC_CENTRE[1],
  GALACTIC_CENTRE[2],
  null,
  0,
];

export function isSpecialStar(slug: string): boolean {
  return slug === SPECIAL_STAR_SLUG;
}
