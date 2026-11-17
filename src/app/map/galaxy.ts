/**
 * Galaxy geometry for the map. The disc layout comes from Robert Hurt's artist's
 * impression for NASA; thickness, bulge and dust are added in galaxyClouds.ts and scene/shaders.ts.
 * Coordinates match the database: parsecs, the Sun at the origin, x towards the
 * galactic centre, y in the direction of rotation and z towards galactic north.
 */

/** The Sun is about 8,200 parsecs from the galactic centre. */
export const GALACTIC_CENTRE: readonly [number, number, number] = [8200, 0, 0];

/**
 * The width of the artist's impression in parsecs. The centre is in the middle of the
 * picture with the Sun 19.1 % of the picture height below it, which sets the scale.
 */
export const GALAXY_PICTURE_WIDTH = GALACTIC_CENTRE[0] / 0.191;
/** The distance from the centre in parsecs beyond which the picture is empty. */
export const GALAXY_EDGE = 21000;
/** The vertical scale height of the disc in parsecs. */
export const DISC_HEIGHT = 260;
/** The bulge adds up to `BULGE_HEIGHT` parsecs of scale height over a radius of about `BULGE_WIDTH` parsecs. */
export const BULGE_HEIGHT = 520;
export const BULGE_WIDTH = 2100;

type Rgb = [number, number, number];

/**
 * Returns the RGB colour (0 to 1) of a star with surface temperature `teffK`, using
 * Tanner Helland's blackbody fit. A missing temperature is treated as 5,600 K, and
 * values are clamped to 2,000–30,000 K where the fit holds.
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
