/**
 * The Milky Way as seen from outside.
 *
 * Nobody has a photograph of our galaxy from outside. What people picture is
 * the artist's impression that Robert Hurt drew for NASA from the surveys of
 * its stars and gas: a bar in the middle, two great arms and several lesser
 * ones, pink clouds of glowing gas along them and dark lanes of dust. The map
 * uses that picture as the plan of the disc and gives it what a flat picture
 * lacks: a thickness, a bulge in the middle and a sheet of dust, so that the
 * galaxy also looks right from the side and from inside (GALAXY_GLOW_FRAGMENT
 * in scene/shaders.ts).
 *
 * Coordinates as in the database: parsecs, the Sun at the origin, x towards
 * the galactic centre, y in the direction the galaxy turns, z to the north.
 */

/** The Sun is about 8,200 parsecs from the centre. */
export const GALACTIC_CENTRE: readonly [number, number, number] = [8200, 0, 0];

/**
 * How many parsecs the picture spans from edge to edge. The galactic centre
 * is in its middle, the Sun below it (towards the centre is up) and the
 * galactic longitude of 90 degrees to the left. In the picture the Sun lies
 * 19.1 % of its height below the centre, which sets the scale.
 */
export const GALAXY_PICTURE_WIDTH = GALACTIC_CENTRE[0] / 0.191;
/** Beyond this distance from the centre the picture is empty. */
export const GALAXY_EDGE = 21000;
/** The light of the disc thins out by the factor e every so many parsecs above and below its plane. */
export const DISC_HEIGHT = 260;
/** The bulge in the middle is thicker by up to this much, and so many parsecs wide. */
export const BULGE_HEIGHT = 520;
export const BULGE_WIDTH = 2100;

type Rgb = [number, number, number];

/**
 * The colour of a star with the surface temperature `teffK` as red, green and
 * blue from 0 to 1: red dwarfs orange, stars like the Sun nearly white, hot
 * stars bluish. An approximation of the colour of a glowing body.
 */
export function starColor(teffK: number | null): Rgb {
  const t = Math.min(Math.max(teffK ?? 5600, 2000), 30000) / 100;
  const clamp = (value: number) => Math.min(Math.max(value / 255, 0), 1);
  const red = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const green =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * (t - 60) ** -0.0755148492;
  const blue = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [clamp(red), clamp(green), clamp(blue)];
}
