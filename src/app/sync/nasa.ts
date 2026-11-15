import type { ClimateClass, PlanetClass } from "@/app/planets/classify";
import { withDerived, type PlanetData } from "@/app/planets/measurements";
import { equatorialToGalactic } from "@/app/stars/coordinates";

const TAP_URL = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync";

/** The columns we read from `pscomppars`. The table has more than 700. */
const COLUMNS = [
  "pl_name",
  "hostname",
  "discoverymethod",
  "disc_year",
  "disc_facility",
  "pl_orbper",
  "pl_orbsmax",
  "pl_orbeccen",
  "pl_rade",
  "pl_rade_reflink",
  "pl_bmasse",
  "pl_bmasse_reflink",
  "pl_bmassprov",
  "pl_dens",
  "pl_dens_reflink",
  "pl_eqt",
  "pl_eqt_reflink",
  "pl_insol",
  "pl_insol_reflink",
  "st_teff",
  "st_rad",
  "st_mass",
  "st_spectype",
  "ra",
  "dec",
  "sy_dist",
  "sy_vmag",
  "hip_name",
  "hd_name",
  "gaia_dr3_id",
  "gaia_dr2_id",
];

export interface CatalogPlanet extends PlanetData {
  name: string;
  hostName: string;
  planetClass: PlanetClass | null;
  climateClass: ClimateClass | null;
  dataHash: string;
}

export interface StarData {
  hip: string | null;
  hd: string | null;
  gaiaId: string | null;
  ra: number | null;
  dec: number | null;
  distPc: number | null;
  x: number | null;
  y: number | null;
  z: number | null;
  spectralType: string | null;
  teffK: number | null;
  radiusSun: number | null;
  massSun: number | null;
  vmag: number | null;
}

export const STAR_FIELDS = [
  "hip",
  "hd",
  "gaiaId",
  "ra",
  "dec",
  "distPc",
  "x",
  "y",
  "z",
  "spectralType",
  "teffK",
  "radiusSun",
  "massSun",
  "vmag",
] as const satisfies readonly (keyof StarData)[];

export interface CatalogStar extends StarData {
  name: string;
}

/** The NASA catalogue in our own format. */
export interface Catalog {
  stars: CatalogStar[];
  planets: CatalogPlanet[];
}

type RawRow = Record<string, unknown>;

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** NASA fills gaps with its own calculations and marks them in the reference column. */
function isCalculated(reflink: unknown): boolean {
  return /calculated/i.test(String(reflink ?? ""));
}

function toPlanet(row: RawRow, name: string, hostName: string): CatalogPlanet {
  const massSource = text(row.pl_bmassprov);
  return withDerived({
    name,
    hostName,
    discoveryMethod: text(row.discoverymethod),
    discoveryYear: num(row.disc_year),
    discoveryFacility: text(row.disc_facility),
    orbitalPeriodDays: num(row.pl_orbper),
    semiMajorAxisAu: num(row.pl_orbsmax),
    eccentricity: num(row.pl_orbeccen),
    radiusEarth: num(row.pl_rade),
    radiusCalculated: isCalculated(row.pl_rade_reflink),
    massEarth: num(row.pl_bmasse),
    massCalculated: isCalculated(row.pl_bmasse_reflink) || massSource === "M-R relationship",
    massIsMinimum: massSource === "Msini",
    density: num(row.pl_dens),
    densityCalculated: isCalculated(row.pl_dens_reflink),
    eqTempK: num(row.pl_eqt),
    eqTempCalculated: isCalculated(row.pl_eqt_reflink),
    insolation: num(row.pl_insol),
    insolationCalculated: isCalculated(row.pl_insol_reflink),
  });
}

/** The most common value. On a tie the one that occurs first wins. */
function mostCommon<T>(values: (T | null)[]): T | null {
  const counts = new Map<T, number>();
  let best: T | null = null;
  let bestCount = 0;
  for (const value of values) {
    if (value === null) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * NASA repeats the star values in every planet row, and they can differ
 * between the planets of one star. The star table takes the most common value
 * of each field.
 */
function toStar(name: string, rows: RawRow[]): CatalogStar {
  const pick = <T>(read: (row: RawRow) => T | null) => mostCommon(rows.map(read));
  const ra = pick((r) => num(r.ra));
  const dec = pick((r) => num(r.dec));
  const distPc = pick((r) => num(r.sy_dist));
  const position =
    ra !== null && dec !== null && distPc !== null
      ? equatorialToGalactic(ra, dec, distPc)
      : { x: null, y: null, z: null };
  return {
    name,
    hip: pick((r) => text(r.hip_name)),
    hd: pick((r) => text(r.hd_name)),
    // Prefer the newer Gaia release, fall back to the older one.
    gaiaId: pick((r) => text(r.gaia_dr3_id) ?? text(r.gaia_dr2_id)),
    ra,
    dec,
    distPc,
    ...position,
    spectralType: pick((r) => text(r.st_spectype)),
    teffK: pick((r) => num(r.st_teff)),
    radiusSun: pick((r) => num(r.st_rad)),
    massSun: pick((r) => num(r.st_mass)),
    vmag: pick((r) => num(r.sy_vmag)),
  };
}

/**
 * Validates NASA's response and converts it to our format. Throws when the
 * response does not look as expected. The sync then stops without changing
 * anything.
 */
export function buildCatalog(response: unknown): Catalog {
  if (!Array.isArray(response)) {
    throw new Error("The response from NASA is not a list.");
  }
  const planets: CatalogPlanet[] = [];
  const rowsByHost = new Map<string, RawRow[]>();
  const seen = new Set<string>();

  const rows = (response as RawRow[])
    .map((row, index) => {
      const name = text(row?.pl_name);
      const hostName = text(row?.hostname);
      if (!name || !hostName) {
        throw new Error(`Row ${index + 1} has no planet name or no star name.`);
      }
      return { row, name, hostName };
    })
    // A fixed order, so the result does not depend on how NASA sorts its rows.
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const { row, name, hostName } of rows) {
    if (seen.has(name)) {
      throw new Error(`The planet "${name}" is listed more than once.`);
    }
    seen.add(name);
    planets.push(toPlanet(row, name, hostName));
    const hostRows = rowsByHost.get(hostName);
    if (hostRows) hostRows.push(row);
    else rowsByHost.set(hostName, [row]);
  }

  const stars = [...rowsByHost].map(([name, hostRows]) => toStar(name, hostRows));
  return { stars, planets };
}

/** Downloads the catalogue of confirmed planets from the NASA Exoplanet Archive. */
export async function fetchCatalog(): Promise<Catalog> {
  const url = new URL(TAP_URL);
  url.searchParams.set("query", `select ${COLUMNS.join(",")} from pscomppars`);
  url.searchParams.set("format", "json");

  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  const body = await response.text();
  if (!response.ok) {
    // The archive explains errors in an XML document. Strip the tags to get the reason.
    const reason = body
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    throw new Error(`NASA answered with status ${response.status}: ${reason.slice(0, 200)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`The response from NASA is not JSON: ${body.slice(0, 200).trim()}`);
  }
  return buildCatalog(parsed);
}
