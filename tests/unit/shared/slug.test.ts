import { describe, expect, it } from "vitest";
import { isSlug, searchKey, slugify, uniqueSlug } from "@/shared/slug";

describe("slugify", () => {
  it("turns names into URL parts", () => {
    expect(slugify("Kepler-22 b")).toBe("kepler-22-b");
    expect(slugify("PSR B1257+12 c")).toBe("psr-b1257-12-c");
    expect(slugify("  2MASS J0103-5515 AB b ")).toBe("2mass-j0103-5515-ab-b");
  });

  it("drops accents", () => {
    expect(slugify("Próxima Centauri b")).toBe("proxima-centauri-b");
  });
});

describe("searchKey", () => {
  it("makes different spellings equal", () => {
    expect(searchKey("Kepler-22 b")).toBe("kepler22b");
    expect(searchKey("kepler 22b")).toBe("kepler22b");
    expect(searchKey("Kepler22b")).toBe("kepler22b");
  });
});

describe("uniqueSlug", () => {
  it("appends a number when the slug is taken", () => {
    const taken = new Set(["a-b"]);
    expect(uniqueSlug("A b", taken)).toBe("a-b-2");
    expect(uniqueSlug("A-b", taken)).toBe("a-b-3");
    expect(uniqueSlug("C d", taken)).toBe("c-d");
  });

  it("falls back to a placeholder for names without letters or digits", () => {
    expect(uniqueSlug("???", new Set())).toBe("unnamed");
  });
});

describe("isSlug", () => {
  it("accepts what slugify and uniqueSlug produce", () => {
    for (const name of ["Kepler-22 b", "TRAPPIST-1 e", "51 Peg b", "Próxima Cen b"]) {
      expect(isSlug(slugify(name)), name).toBe(true);
    }
    expect(isSlug(uniqueSlug("Kepler-22 b", new Set(["kepler-22-b"])))).toBe(true);
    expect(isSlug("unnamed")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const value of ["", "-a", "a-", "a--b", "A", "a b", "a/b", "../etc", "a\u0000", "%00", "a'--", "a".repeat(201)]) {
      expect(isSlug(value), JSON.stringify(value)).toBe(false);
    }
  });
});
