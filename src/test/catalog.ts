import { nasaRow } from "@/app/sync/test-fixtures";

/**
 * A small catalogue in the format of the NASA Exoplanet Archive. The database
 * tests and the browser tests run on it instead of the real catalogue with its
 * several thousand planets.
 *
 * It holds the planets the start page features, a few names that test the
 * search and the natural order ("Kepler-12 b" before "Kepler-129 b"), a star
 * without a known distance (it cannot be placed on the map) and one planet
 * that NASA withdraws in the second sync run.
 */

interface Host {
  hostname: string;
  ra: number | null;
  dec: number | null;
  sy_dist: number | null;
  st_teff: number;
  st_rad: number;
  st_mass: number;
  st_spectype: string | null;
  sy_vmag: number | null;
  gaia_dr3_id: string;
  gaia_dr2_id: string;
}

const host = (h: Host) => h;

const TRAPPIST = host({
  hostname: "TRAPPIST-1",
  ra: 346.6223683,
  dec: -5.0413975,
  sy_dist: 12.429,
  st_teff: 2566,
  st_rad: 0.119,
  st_mass: 0.09,
  st_spectype: "M8 V",
  sy_vmag: 18.8,
  gaia_dr3_id: "Gaia DR3 2635476908753563008",
  gaia_dr2_id: "Gaia DR2 2635476908753563008",
});

const PROXIMA = host({
  hostname: "Proxima Cen",
  ra: 217.3934657,
  dec: -62.6761821,
  sy_dist: 1.30119,
  st_teff: 3050,
  st_rad: 0.14,
  st_mass: 0.12,
  st_spectype: "M5.5 V",
  sy_vmag: 11.13,
  gaia_dr3_id: "Gaia DR3 5853498713190525696",
  gaia_dr2_id: "Gaia DR2 5853498713160606720",
});

const PEG51 = host({
  hostname: "51 Peg",
  ra: 344.3665853,
  dec: 20.7689082,
  sy_dist: 15.4614,
  st_teff: 5758,
  st_rad: 1.15,
  st_mass: 1.09,
  st_spectype: "G2 IV",
  sy_vmag: 5.45,
  gaia_dr3_id: "Gaia DR3 2835207319109249920",
  gaia_dr2_id: "Gaia DR2 2835207319109249920",
});

const CNC55 = host({
  hostname: "55 Cnc",
  ra: 133.1499279,
  dec: 28.3308218,
  sy_dist: 12.5855,
  st_teff: 5172,
  st_rad: 0.94,
  st_mass: 0.91,
  st_spectype: "K0 IV-V",
  sy_vmag: 5.95,
  gaia_dr3_id: "Gaia DR3 704967037090946688",
  gaia_dr2_id: "Gaia DR2 704967037090946688",
});

const K218 = host({
  hostname: "K2-18",
  ra: 172.5605371,
  dec: 7.5878661,
  sy_dist: 38.0703,
  st_teff: 3457,
  st_rad: 0.41,
  st_mass: 0.36,
  st_spectype: "M2.5 V",
  sy_vmag: 13.5,
  gaia_dr3_id: "Gaia DR3 3910747531814692736",
  gaia_dr2_id: "Gaia DR2 3910747531814692736",
});

function kepler(n: number, ra: number, dec: number, dist: number, teff: number): Host {
  return {
    hostname: `Kepler-${n}`,
    ra,
    dec,
    sy_dist: dist,
    st_teff: teff,
    st_rad: 1,
    st_mass: 1,
    st_spectype: null,
    sy_vmag: 13,
    gaia_dr3_id: `Gaia DR3 9000000000000${n}`,
    gaia_dr2_id: `Gaia DR2 9000000000000${n}`,
  };
}

const NODIST = host({
  hostname: "Nodist-1",
  ra: null,
  dec: null,
  sy_dist: null,
  st_teff: 4000,
  st_rad: 0.7,
  st_mass: 0.7,
  st_spectype: null,
  sy_vmag: null,
  gaia_dr3_id: "Gaia DR3 1111",
  gaia_dr2_id: "Gaia DR2 1111",
});

const RETRACTED = host({
  hostname: "Retracted-1",
  ra: 10,
  dec: 10,
  sy_dist: 100,
  st_teff: 5000,
  st_rad: 1,
  st_mass: 1,
  st_spectype: null,
  sy_vmag: 12,
  gaia_dr3_id: "Gaia DR3 2222",
  gaia_dr2_id: "Gaia DR2 2222",
});

interface PlanetValues {
  pl_name: string;
  disc_year: number;
  discoverymethod?: string;
  pl_orbper: number;
  pl_orbsmax: number;
  pl_rade: number;
  pl_bmasse: number | null;
  pl_eqt: number | null;
  pl_insol: number | null;
}

function planet(h: Host, values: PlanetValues) {
  return nasaRow({ ...h, pl_dens: null, ...values });
}

/** The planets of TRAPPIST-1, from the inside out. */
const TRAPPIST_PLANETS: [string, number, number, number, number, number][] = [
  // letter, period (days), semi-major axis (AU), radius, mass, eq. temperature
  ["b", 1.51088, 0.01154, 1.116, 1.374, 400],
  ["c", 2.42207, 0.0158, 1.097, 1.308, 342],
  ["d", 4.04961, 0.02227, 0.788, 0.388, 288],
  ["e", 6.09961, 0.02925, 0.92, 0.692, 250],
  ["f", 9.2067, 0.03849, 1.045, 1.039, 219],
  ["g", 12.35447, 0.04683, 1.129, 1.321, 199],
  ["h", 18.7729, 0.06189, 0.755, 0.326, 173],
];

/** All rows of the first sync run. */
export const FIXTURE_ROWS = [
  ...TRAPPIST_PLANETS.map(([letter, period, axis, radius, mass, eqt]) =>
    planet(TRAPPIST, {
      pl_name: `TRAPPIST-1 ${letter}`,
      disc_year: letter === "b" || letter === "c" ? 2016 : 2017,
      pl_orbper: period,
      pl_orbsmax: axis,
      pl_rade: radius,
      pl_bmasse: mass,
      pl_eqt: eqt,
      pl_insol: null,
    }),
  ),
  planet(PROXIMA, {
    pl_name: "Proxima Cen b",
    disc_year: 2016,
    discoverymethod: "Radial Velocity",
    pl_orbper: 11.1868,
    pl_orbsmax: 0.04856,
    pl_rade: 1.03,
    pl_bmasse: 1.07,
    pl_eqt: 234,
    pl_insol: 0.65,
  }),
  planet(PEG51, {
    pl_name: "51 Peg b",
    disc_year: 1995,
    discoverymethod: "Radial Velocity",
    pl_orbper: 4.230785,
    pl_orbsmax: 0.0527,
    pl_rade: 13.7,
    pl_bmasse: 146.2,
    pl_eqt: 1260,
    pl_insol: 340,
  }),
  planet(CNC55, {
    pl_name: "55 Cnc e",
    disc_year: 2004,
    pl_orbper: 0.7365474,
    pl_orbsmax: 0.01544,
    pl_rade: 1.88,
    pl_bmasse: 7.99,
    pl_eqt: 1958,
    pl_insol: 2400,
  }),
  planet(K218, {
    pl_name: "K2-18 b",
    disc_year: 2015,
    pl_orbper: 32.94007,
    pl_orbsmax: 0.1591,
    pl_rade: 2.61,
    pl_bmasse: 8.63,
    pl_eqt: 255,
    pl_insol: 1.0,
  }),
  planet(kepler(22, 289.2175, 47.884, 194.4, 5596), {
    pl_name: "Kepler-22 b",
    disc_year: 2011,
    pl_orbper: 289.8623,
    pl_orbsmax: 0.812,
    pl_rade: 2.1,
    pl_bmasse: null,
    pl_eqt: 279,
    pl_insol: 1.1,
  }),
  planet(kepler(220, 291.0, 46.0, 170.0, 4632), {
    pl_name: "Kepler-220 b",
    disc_year: 2014,
    pl_orbper: 4.159807,
    pl_orbsmax: 0.0459,
    pl_rade: 0.81,
    pl_bmasse: null,
    pl_eqt: 860,
    pl_insol: 90,
  }),
  planet(kepler(12, 286.0, 50.0, 590.0, 5947), {
    pl_name: "Kepler-12 b",
    disc_year: 2011,
    pl_orbper: 4.437963,
    pl_orbsmax: 0.0556,
    pl_rade: 19.0,
    pl_bmasse: 137,
    pl_eqt: 1485,
    pl_insol: 800,
  }),
  planet(kepler(129, 292.0, 49.0, 400.0, 5770), {
    pl_name: "Kepler-129 b",
    disc_year: 2016,
    pl_orbper: 15.79186,
    pl_orbsmax: 0.1311,
    pl_rade: 2.4,
    pl_bmasse: null,
    pl_eqt: 650,
    pl_insol: 70,
  }),
  planet(NODIST, {
    pl_name: "Nodist-1 b",
    disc_year: 2020,
    pl_orbper: 3.5,
    pl_orbsmax: 0.04,
    pl_rade: 11,
    pl_bmasse: 300,
    pl_eqt: 1300,
    pl_insol: 500,
  }),
  planet(RETRACTED, {
    pl_name: "Retracted-1 b",
    disc_year: 2019,
    pl_orbper: 7.0,
    pl_orbsmax: 0.07,
    pl_rade: 1.5,
    pl_bmasse: null,
    pl_eqt: 900,
    pl_insol: 100,
  }),
];

/** The rows of the second sync run: NASA no longer lists Retracted-1 b. */
export const FIXTURE_ROWS_AFTER_RETRACTION = FIXTURE_ROWS.filter(
  (row) => row.pl_name !== "Retracted-1 b",
);

/** Number of exoplanets that are active after both runs. */
export const ACTIVE_EXOPLANETS = FIXTURE_ROWS_AFTER_RETRACTION.length;
