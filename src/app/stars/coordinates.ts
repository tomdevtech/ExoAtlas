const DEG = Math.PI / 180;

// Rotation matrix from the equatorial system (J2000) to the galactic system.
const TO_GALACTIC = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.44482963, 0.7469822445],
  [-0.867666149, -0.1980763734, 0.4559837762],
] as const;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Converts right ascension and declination (degrees) plus distance (parsecs) to galactic coordinates in parsecs.
 * The Sun is at the origin, x points to the galactic centre, y in the direction of rotation and z to the galactic north pole.
 */
export function equatorialToGalactic(
  raDeg: number,
  decDeg: number,
  distPc: number,
): Vec3 {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const eq = [
    Math.cos(dec) * Math.cos(ra),
    Math.cos(dec) * Math.sin(ra),
    Math.sin(dec),
  ];
  const [x, y, z] = TO_GALACTIC.map(
    (row) => distPc * (row[0] * eq[0] + row[1] * eq[1] + row[2] * eq[2]),
  );
  return { x, y, z };
}

/** Angle between two sky positions in arcseconds. It uses a flat-sky approximation that is only accurate for small separations. */
export function separationArcsec(
  a: { ra: number; dec: number },
  b: { ra: number; dec: number },
): number {
  let dRa = Math.abs(a.ra - b.ra);
  if (dRa > 180) dRa = 360 - dRa;
  const meanDec = ((a.dec + b.dec) / 2) * DEG;
  return Math.hypot(dRa * Math.cos(meanDec), a.dec - b.dec) * 3600;
}
