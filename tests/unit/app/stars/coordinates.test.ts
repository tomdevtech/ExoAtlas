import { describe, expect, it } from "vitest";
import { equatorialToGalactic, separationArcsec } from "@/app/stars/coordinates";

describe("equatorialToGalactic", () => {
  it("puts the galactic centre on the x axis", () => {
    const p = equatorialToGalactic(266.40499, -28.93617, 8000);
    expect(p.x).toBeCloseTo(8000, 0);
    expect(p.y).toBeCloseTo(0, 0);
    expect(p.z).toBeCloseTo(0, 0);
  });

  it("puts the galactic north pole on the z axis", () => {
    const p = equatorialToGalactic(192.85948, 27.12825, 100);
    expect(p.x).toBeCloseTo(0, 1);
    expect(p.y).toBeCloseTo(0, 1);
    expect(p.z).toBeCloseTo(100, 1);
  });

  it("keeps the distance", () => {
    const p = equatorialToGalactic(123.4, -56.7, 42);
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(42, 6);
  });
});

describe("separationArcsec", () => {
  it("measures a separation in declination", () => {
    const a = { ra: 10, dec: 20 };
    const b = { ra: 10, dec: 20 + 1 / 3600 };
    expect(separationArcsec(a, b)).toBeCloseTo(1, 6);
  });

  it("accounts for right ascension getting narrower towards the pole", () => {
    const a = { ra: 10, dec: 60 };
    const b = { ra: 10 + 2 / 3600, dec: 60 };
    expect(separationArcsec(a, b)).toBeCloseTo(1, 3);
  });

  it("handles the wrap from 360 to 0 degrees", () => {
    const a = { ra: 359.9999, dec: 0 };
    const b = { ra: 0.0001, dec: 0 };
    expect(separationArcsec(a, b)).toBeCloseTo(0.72, 2);
  });
});
