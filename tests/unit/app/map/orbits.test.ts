import { describe, expect, it } from "vitest";
import {
  axisFromPeriod,
  layoutMoons,
  layoutOrbits,
  moonSize,
  orbitPoint,
  periodFromAxis,
  planetSize,
  solveKepler,
  starSize,
  viewPeriod,
  viewRadius,
  type OrbitInput,
} from "@/app/map/orbits";

function planet(overrides: Partial<OrbitInput> = {}): OrbitInput {
  return {
    orbitalPeriodDays: null,
    semiMajorAxisAu: null,
    eccentricity: null,
    radiusEarth: 1,
    ...overrides,
  };
}

const SUN = { massSun: 1, radiusSun: 1 };

describe("Kepler's third law", () => {
  it("puts a planet with a period of one year at one astronomical unit", () => {
    expect(axisFromPeriod(365.25, 1)).toBeCloseTo(1, 6);
    expect(periodFromAxis(1, 1)).toBeCloseTo(365.25, 6);
  });

  it("converts back and forth without loss", () => {
    expect(periodFromAxis(axisFromPeriod(11.2, 0.12), 0.12)).toBeCloseTo(11.2, 6);
  });
});

describe("solveKepler", () => {
  it("returns the mean anomaly itself on a circle", () => {
    expect(solveKepler(1.3, 0)).toBeCloseTo(1.3, 9);
  });

  it("solves the equation for flat ellipses too", () => {
    for (const eccentricity of [0.1, 0.5, 0.75, 0.9]) {
      for (const mean of [0.01, 1, 3, 5.5]) {
        const E = solveKepler(mean, eccentricity);
        expect(E - eccentricity * Math.sin(E)).toBeCloseTo(mean, 6);
      }
    }
  });
});

describe("orbitPoint", () => {
  it("starts at the point closest to the star", () => {
    const [x, y] = orbitPoint(10, 0.4, 0, 0);
    expect(x).toBeCloseTo(6, 6);
    expect(y).toBeCloseTo(0, 6);
  });

  it("is farthest from the star half a lap later", () => {
    const [x, y] = orbitPoint(10, 0.4, 0, Math.PI);
    expect(Math.hypot(x, y)).toBeCloseTo(14, 6);
  });

  it("turns the ellipse by the direction of the closest point", () => {
    const [x, y] = orbitPoint(10, 0.4, Math.PI / 2, 0);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(6, 6);
  });

  it("stays on a circle when the eccentricity is zero", () => {
    for (const mean of [0, 0.7, 2.9, 4.4, 9]) {
      const [x, y] = orbitPoint(5, 0, 1, mean);
      expect(Math.hypot(x, y)).toBeCloseTo(5, 6);
    }
  });
});

describe("sizes in the view", () => {
  it("keeps the order of sizes but not the proportions", () => {
    expect(planetSize(11.2)).toBeGreaterThan(planetSize(1));
    expect(planetSize(11.2) / planetSize(1)).toBeLessThan(11.2);
    expect(starSize(100)).toBeGreaterThan(starSize(1));
    expect(starSize(100)).toBeLessThanOrEqual(2.2);
  });

  it("uses a middling size when the radius is unknown", () => {
    expect(planetSize(null)).toBe(planetSize(2));
    expect(starSize(null)).toBe(1);
  });
});

describe("layoutOrbits", () => {
  it("sorts the orbits from the inside out and remembers the planet", () => {
    const layouts = layoutOrbits(
      [planet({ semiMajorAxisAu: 5 }), planet({ semiMajorAxisAu: 0.4 }), planet({ semiMajorAxisAu: 1 })],
      SUN,
    );
    expect(layouts.map((layout) => layout.index)).toEqual([1, 2, 0]);
    expect(layouts[0].semiMajor).toBeLessThan(layouts[1].semiMajor);
    expect(layouts[1].semiMajor).toBeLessThan(layouts[2].semiMajor);
  });

  it("keeps the innermost orbit clear of the star, also when it is an ellipse", () => {
    const [layout] = layoutOrbits([planet({ semiMajorAxisAu: 0.01, eccentricity: 0.6 })], {
      massSun: 1,
      radiusSun: 50,
    });
    const closest = layout.semiMajor * (1 - layout.eccentricity);
    expect(closest).toBeGreaterThan(starSize(50) + layout.size);
  });

  it("leaves room between neighbours that are almost at the same distance", () => {
    const layouts = layoutOrbits(
      [planet({ semiMajorAxisAu: 1, radiusEarth: 11 }), planet({ semiMajorAxisAu: 1.001, radiusEarth: 11 })],
      SUN,
    );
    const gap = layouts[1].semiMajor - layouts[0].semiMajor;
    expect(gap).toBeGreaterThan(layouts[0].size + layouts[1].size);
  });

  it("squeezes huge gaps", () => {
    const layouts = layoutOrbits([planet({ semiMajorAxisAu: 0.01 }), planet({ semiMajorAxisAu: 5000 })], SUN);
    expect(layouts[1].semiMajor - layouts[0].semiMajor).toBeLessThanOrEqual(4);
  });

  it("derives the distance from the period when only the period is known", () => {
    const layouts = layoutOrbits(
      [planet({ orbitalPeriodDays: 4000 }), planet({ semiMajorAxisAu: 1 }), planet({ orbitalPeriodDays: 10 })],
      SUN,
    );
    expect(layouts.map((layout) => layout.index)).toEqual([2, 1, 0]);
  });

  it("puts planets without any orbit data on the outside", () => {
    const layouts = layoutOrbits([planet(), planet({ semiMajorAxisAu: 3 }), planet()], SUN);
    expect(layouts.map((layout) => layout.index)).toEqual([1, 0, 2]);
    expect(layouts.every((layout) => Number.isFinite(layout.semiMajor) && layout.period > 0)).toBe(true);
  });

  it("copes with a system in which nothing is known", () => {
    const layouts = layoutOrbits([planet({ radiusEarth: null })], { massSun: null, radiusSun: null });
    expect(layouts).toHaveLength(1);
    expect(Number.isFinite(layouts[0].semiMajor)).toBe(true);
    expect(Number.isFinite(layouts[0].period)).toBe(true);
  });

  it("lets inner planets run faster, within limits", () => {
    const layouts = layoutOrbits(
      [planet({ orbitalPeriodDays: 0.5 }), planet({ orbitalPeriodDays: 365 }), planet({ orbitalPeriodDays: 1e7 })],
      SUN,
    );
    expect(layouts[0].period).toBeLessThan(layouts[1].period);
    expect(layouts[1].period).toBeLessThan(layouts[2].period);
    expect(layouts[0].period).toBeGreaterThanOrEqual(3);
    expect(layouts[2].period).toBeLessThanOrEqual(240);
  });

  it("limits the eccentricity so that no orbit runs through the star", () => {
    const [flat] = layoutOrbits([planet({ semiMajorAxisAu: 1, eccentricity: 0.97 })], SUN);
    const [negative] = layoutOrbits([planet({ semiMajorAxisAu: 1, eccentricity: -0.2 })], SUN);
    expect(flat.eccentricity).toBe(0.75);
    expect(negative.eccentricity).toBe(0);
  });

  it("starts a system the same way on every visit", () => {
    const planets = [planet({ semiMajorAxisAu: 1 }), planet({ semiMajorAxisAu: 2 })];
    expect(layoutOrbits(planets, SUN, 42)).toEqual(layoutOrbits(planets, SUN, 42));
    expect(layoutOrbits(planets, SUN, 42)[0].phase).not.toBe(layoutOrbits(planets, SUN, 43)[0].phase);
  });
});

describe("viewRadius", () => {
  const layouts = layoutOrbits(
    [planet({ semiMajorAxisAu: 1 }), planet({ semiMajorAxisAu: 5.2 }), planet({ semiMajorAxisAu: 30 })],
    SUN,
  );

  it("lands exactly on every orbit", () => {
    for (const layout of layouts) expect(viewRadius(layouts, layout.axisAu)).toBeCloseTo(layout.semiMajor, 9);
  });

  it("grows with the real distance, inside, between and beyond the orbits", () => {
    const distances = [0.3, 0.9, 2.8, 5.2, 12, 30, 45, 2000, 100000];
    const radii = distances.map((au) => viewRadius(layouts, au));
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeGreaterThan(radii[i - 1]);
  });

  it("adds 1.6 units for each doubling beyond the outermost orbit, like layoutOrbits", () => {
    const last = layouts[layouts.length - 1];
    expect(viewRadius(layouts, last.axisAu * 4) - last.semiMajor).toBeCloseTo(3.2, 9);
  });

  it("is proportional inside the innermost orbit", () => {
    expect(viewRadius(layouts, 0.5)).toBeCloseTo(layouts[0].semiMajor / 2, 9);
  });
});

describe("viewPeriod", () => {
  it("lets longer orbits take longer, within limits", () => {
    expect(viewPeriod(88)).toBeLessThan(viewPeriod(365));
    expect(viewPeriod(0.1)).toBe(3);
    expect(viewPeriod(1e7)).toBe(240);
  });
});

describe("layoutMoons", () => {
  const galilean = [
    { semiMajorAxisKm: 1882700, orbitalPeriodDays: 16.69, eccentricity: 0.007, radiusKm: 2410 },
    { semiMajorAxisKm: 421800, orbitalPeriodDays: 1.77, eccentricity: 0.004, radiusKm: 1821 },
    { semiMajorAxisKm: 671100, orbitalPeriodDays: 3.55, eccentricity: 0.009, radiusKm: 1561 },
    { semiMajorAxisKm: 1070400, orbitalPeriodDays: 7.15, eccentricity: 0.001, radiusKm: 2631 },
  ];
  const jupiter = { size: planetSize(11.21), radiusKm: 69911, reach: 1 };

  it("keeps the order of the moons and remembers each one", () => {
    const layouts = layoutMoons(galilean, jupiter);
    expect(layouts.map((layout) => layout.index)).toEqual([1, 2, 3, 0]);
    for (let i = 1; i < layouts.length; i++) {
      expect(layouts[i].semiMajor).toBeGreaterThan(layouts[i - 1].semiMajor);
      expect(layouts[i].period).toBeGreaterThan(layouts[i - 1].period);
    }
  });

  it("keeps every moon clear of the planet, its rings and its neighbours", () => {
    for (const reach of [1, 2.27]) {
      const layouts = layoutMoons(galilean, { ...jupiter, reach });
      expect(layouts[0].semiMajor * (1 - layouts[0].eccentricity) - layouts[0].size).toBeGreaterThan(jupiter.size * reach);
      for (let i = 1; i < layouts.length; i++) {
        expect(layouts[i].semiMajor - layouts[i - 1].semiMajor).toBeGreaterThan(layouts[i].size + layouts[i - 1].size);
      }
    }
  });

  it("compresses a moon system to a few planet radii", () => {
    const layouts = layoutMoons(galilean, jupiter);
    // Callisto is 27 Jupiter radii out; on the map it stays within about six.
    expect(layouts[3].semiMajor / jupiter.size).toBeLessThan(6);
  });

  it("makes moons smaller than their planet but never invisible", () => {
    for (const layout of layoutMoons(galilean, jupiter)) {
      expect(layout.size).toBeLessThan(jupiter.size);
      expect(layout.size).toBeGreaterThanOrEqual(0.02);
    }
    expect(moonSize(10)).toBe(0.02);
  });

  it("starts the moons the same way on every visit", () => {
    expect(layoutMoons(galilean, jupiter, 7)).toEqual(layoutMoons(galilean, jupiter, 7));
  });
});
