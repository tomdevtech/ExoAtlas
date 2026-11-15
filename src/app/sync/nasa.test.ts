import { describe, expect, it } from "vitest";
import { hashPlanet } from "../planets/measurements";
import { buildCatalog } from "./nasa";
import { CALCULATED, nasaRow } from "./test-fixtures";

describe("buildCatalog", () => {
  it("converts a row into a planet and a star", () => {
    const { planets, stars } = buildCatalog([nasaRow()]);
    expect(planets).toHaveLength(1);
    expect(planets[0]).toMatchObject({
      name: "Test b",
      hostName: "Test",
      radiusEarth: 1.1,
      radiusCalculated: false,
      massIsMinimum: false,
      planetClass: "rocky",
      climateClass: "temperate",
    });
    expect(stars).toHaveLength(1);
    expect(stars[0]).toMatchObject({
      name: "Test",
      teffK: 5000,
      gaiaId: "Gaia DR3 1",
    });
    expect(Math.hypot(stars[0].x!, stars[0].y!, stars[0].z!)).toBeCloseTo(50, 6);
  });

  it("falls back to the older Gaia release", () => {
    const { stars } = buildCatalog([nasaRow({ gaia_dr3_id: null })]);
    expect(stars[0].gaiaId).toBe("Gaia DR2 1");
  });

  it("recognises calculated values and minimum masses", () => {
    const { planets } = buildCatalog([
      nasaRow({
        pl_name: "A b",
        pl_rade_reflink: CALCULATED,
        pl_bmassprov: "Msini",
      }),
      nasaRow({
        pl_name: "A c",
        pl_bmasse_reflink: CALCULATED,
        pl_bmassprov: "M-R relationship",
      }),
    ]);
    expect(planets[0]).toMatchObject({
      radiusCalculated: true,
      massCalculated: false,
      massIsMinimum: true,
    });
    expect(planets[1]).toMatchObject({
      radiusCalculated: false,
      massCalculated: true,
      massIsMinimum: false,
    });
  });

  it("treats empty values as unknown", () => {
    const { planets, stars } = buildCatalog([
      nasaRow({
        pl_rade: null,
        pl_bmasse: "",
        pl_eqt: null,
        sy_dist: null,
        st_spectype: " ",
      }),
    ]);
    expect(planets[0]).toMatchObject({
      radiusEarth: null,
      massEarth: null,
      planetClass: null,
      climateClass: null,
    });
    expect(stars[0]).toMatchObject({
      distPc: null,
      x: null,
      spectralType: null,
    });
  });

  it("takes the most common value of a star from its planet rows", () => {
    const { stars } = buildCatalog([
      nasaRow({ pl_name: "A b", hostname: "A", st_teff: 5198 }),
      nasaRow({ pl_name: "A c", hostname: "A", st_teff: 5172 }),
      nasaRow({ pl_name: "A d", hostname: "A", st_teff: 5198 }),
    ]);
    expect(stars).toHaveLength(1);
    expect(stars[0].teffK).toBe(5198);
  });

  it("does not depend on the order of the rows", () => {
    const rows = [
      nasaRow({ pl_name: "A b", hostname: "A", st_teff: 5000 }),
      nasaRow({ pl_name: "A c", hostname: "A", st_teff: 5100 }),
    ];
    expect(buildCatalog([...rows].reverse())).toEqual(buildCatalog(rows));
  });

  it("rejects broken responses", () => {
    expect(() => buildCatalog({ error: "x" })).toThrow(/not a list/);
    expect(() => buildCatalog([nasaRow({ pl_name: "" })])).toThrow(/Row 1/);
    expect(() => buildCatalog([nasaRow(), nasaRow()])).toThrow(/more than once/);
  });
});

describe("hashPlanet", () => {
  it("changes only when a measured value of the planet changes", () => {
    const [base] = buildCatalog([nasaRow()]).planets;
    const [otherStar] = buildCatalog([nasaRow({ st_teff: 9999 })]).planets;
    const [otherRadius] = buildCatalog([nasaRow({ pl_rade: 1.2 })]).planets;
    expect(hashPlanet(otherStar)).toBe(base.dataHash);
    expect(otherRadius.dataHash).not.toBe(base.dataHash);
  });
});
