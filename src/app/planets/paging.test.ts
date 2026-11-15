import { describe, expect, it } from "vitest";
import {
  PAGE_SIZE,
  clampPage,
  listHref,
  pageCount,
  pageLinks,
  parseFilter,
  parsePage,
  parseSort,
} from "./paging";

describe("parsePage", () => {
  it("reads a whole number from 1 up", () => {
    expect(parsePage("1")).toBe(1);
    expect(parsePage("17")).toBe(17);
    expect(parsePage(" 3 ")).toBe(3);
  });

  it("takes the first value when the address names the page twice", () => {
    expect(parsePage(["4", "9"])).toBe(4);
  });

  it("falls back to page 1 for anything else", () => {
    for (const value of [undefined, "", "0", "-2", "1.5", "abc", "2e3", "99999999999999999999"]) {
      expect(parsePage(value)).toBe(1);
    }
  });
});

describe("parseFilter", () => {
  it("trims the text and treats a missing value as empty", () => {
    expect(parseFilter("  kepler 22 ")).toBe("kepler 22");
    expect(parseFilter(undefined)).toBe("");
    expect(parseFilter(["trappist", "x"])).toBe("trappist");
  });
});

describe("parseSort", () => {
  it("knows the order by discovery and falls back to the order by name", () => {
    expect(parseSort("discovery")).toBe("discovery");
    expect(parseSort(["discovery", "name"])).toBe("discovery");
    for (const value of [undefined, "", "name", "Discovery", "year", "discovery desc"]) {
      expect(parseSort(value)).toBe("name");
    }
  });
});

describe("pageCount and clampPage", () => {
  it("counts full and partly filled pages", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(1)).toBe(1);
    expect(pageCount(PAGE_SIZE)).toBe(1);
    expect(pageCount(PAGE_SIZE + 1)).toBe(2);
    expect(pageCount(6478)).toBe(33);
  });

  it("moves a page beyond the end to the last page", () => {
    expect(clampPage(999, 6478)).toBe(33);
    expect(clampPage(33, 6478)).toBe(33);
    expect(clampPage(2, 0)).toBe(1);
  });
});

describe("listHref", () => {
  it("leaves out page 1 and an empty filter", () => {
    expect(listHref("")).toBe("/planets");
    expect(listHref("", 1)).toBe("/planets");
    expect(listHref("", 3)).toBe("/planets?page=3");
  });

  it("encodes the filter", () => {
    expect(listHref("kepler 22")).toBe("/planets?q=kepler+22");
    expect(listHref("a&b=c", 2)).toBe("/planets?q=a%26b%3Dc&page=2");
  });

  it("names the order only when it is not by name", () => {
    expect(listHref("", 1, "name")).toBe("/planets");
    expect(listHref("", 1, "discovery")).toBe("/planets?sort=discovery");
    expect(listHref("toi", 4, "discovery")).toBe("/planets?q=toi&sort=discovery&page=4");
  });
});

describe("pageLinks", () => {
  it("shows every page of a short list", () => {
    expect(pageLinks(1, 1)).toEqual([1]);
    expect(pageLinks(2, 3)).toEqual([1, 2, 3]);
    expect(pageLinks(1, 4)).toEqual([1, 2, 3, 4]);
  });

  it("keeps the first, the last and the neighbours of the current page", () => {
    expect(pageLinks(1, 33)).toEqual([1, 2, "gap", 33]);
    expect(pageLinks(5, 33)).toEqual([1, "gap", 4, 5, 6, "gap", 33]);
    expect(pageLinks(33, 33)).toEqual([1, "gap", 32, 33]);
  });

  it("shows a number instead of a gap that would hide only that number", () => {
    expect(pageLinks(4, 33)).toEqual([1, 2, 3, 4, 5, "gap", 33]);
    expect(pageLinks(30, 33)).toEqual([1, "gap", 29, 30, 31, 32, 33]);
  });

  it("always contains the current page exactly once, in rising order", () => {
    for (let count = 1; count <= 40; count++) {
      for (let current = 1; current <= count; current++) {
        const numbers = pageLinks(current, count).filter((link) => link !== "gap");
        expect(numbers.filter((page) => page === current)).toHaveLength(1);
        expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
        expect(numbers[0]).toBe(1);
        expect(numbers.at(-1)).toBe(count);
      }
    }
  });
});
