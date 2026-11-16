import { describe, expect, it } from "vitest";
import { mixColors, shade } from "@/app/planets/color";

describe("mixColors", () => {
  it("gives the ends and what lies between them", () => {
    expect(mixColors("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixColors("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixColors("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixColors("#ff0000", "#0000ff", 0.25)).toBe("#bf0040");
  });

  it("does not go beyond the ends", () => {
    expect(mixColors("#102030", "#405060", -2)).toBe("#102030");
    expect(mixColors("#102030", "#405060", 7)).toBe("#405060");
  });
});

describe("shade", () => {
  it("leaves a colour alone when nothing is asked", () => {
    for (const color of ["#000000", "#ffffff", "#3f6f45", "#ff5a1f", "#1c4f8a", "#808080"]) {
      expect(shade(color, {})).toBe(color);
    }
  });

  it("turns a colour round the colour wheel", () => {
    expect(shade("#ff0000", { hue: 120 })).toBe("#00ff00");
    expect(shade("#ff0000", { hue: -120 })).toBe("#0000ff");
    expect(shade("#ff0000", { hue: 360 })).toBe("#ff0000");
  });

  it("makes a colour greyer or stronger", () => {
    expect(shade("#ff0000", { saturation: 0 })).toBe("#808080");
    const [red, green] = [1, 3].map((at) => Number.parseInt(shade("#c08040", { saturation: 0.5 }).slice(at, at + 2), 16));
    // Still a brown, but closer to grey: the channels lie nearer together.
    expect(red - green).toBeLessThan(0xc0 - 0x80);
    expect(red).toBeGreaterThan(green);
  });

  it("makes a colour darker or lighter, down to black and up to white", () => {
    expect(shade("#808080", { lightness: 0.2 })).toBe("#b3b3b3");
    expect(shade("#808080", { lightness: -1 })).toBe("#000000");
    expect(shade("#3f6f45", { lightness: 1 })).toBe("#ffffff");
  });
});
