import { describe, expect, it } from "vitest";
import {
  formatCount,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPeriod,
  kelvinToCelsius,
  parsecToLightYears,
} from "@/shared/format";

describe("formatNumber", () => {
  it("keeps about three significant digits", () => {
    expect(formatNumber(1234.5)).toBe("1,235");
    expect(formatNumber(317.8)).toBe("318");
    expect(formatNumber(12.345)).toBe("12.3");
    expect(formatNumber(1.2345)).toBe("1.23");
    expect(formatNumber(0.01234)).toBe("0.0123");
    expect(formatNumber(0)).toBe("0");
  });
});

describe("formatCount", () => {
  it("adds thousands separators", () => {
    expect(formatCount(6470)).toBe("6,470");
  });
});

describe("formatPeriod", () => {
  it("uses days below two years and years above", () => {
    expect(formatPeriod(3.5)).toBe("3.5 days");
    expect(formatPeriod(365.2)).toBe("365 days");
    expect(formatPeriod(4331)).toBe("11.9 years");
  });
});

describe("dates", () => {
  const date = new Date("2026-11-14T19:53:00Z");

  it("prints dates in UTC", () => {
    expect(formatDate(date)).toBe("November 14, 2026");
    expect(formatDate(new Date("2026-11-14T23:30:00Z"))).toBe("November 14, 2026");
  });

  it("prints date and time with the time zone", () => {
    expect(formatDateTime(date)).toMatch(/^November 14, 2026.*7:53.PM UTC$/);
  });
});

describe("unit conversion", () => {
  it("converts parsecs to light-years", () => {
    expect(parsecToLightYears(1)).toBeCloseTo(3.26156, 5);
    expect(parsecToLightYears(10)).toBeCloseTo(32.6156, 4);
  });

  it("converts kelvin to degrees Celsius", () => {
    expect(kelvinToCelsius(273.15)).toBeCloseTo(0, 10);
    expect(kelvinToCelsius(0)).toBeCloseTo(-273.15, 10);
  });
});
