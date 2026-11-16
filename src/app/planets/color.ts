/**
 * Small helpers for the colours of the planets. Colours are "#rrggbb" texts,
 * as the rest of the app passes them around.
 */

type Rgb = [number, number, number];

function parse(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function format([red, green, blue]: Rgb): string {
  const channel = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

/** The colour between two colours: `share` 0 gives the first, 1 the second. */
export function mixColors(from: string, to: string, share: number): string {
  const a = parse(from);
  const b = parse(to);
  const t = Math.min(1, Math.max(0, share));
  return format([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

/** How a colour is changed by `shade`. Everything left out stays as it is. */
export interface Shade {
  /** Degrees around the colour wheel. */
  hue?: number;
  /** Factor on the saturation: below 1 greyer, above 1 stronger. */
  saturation?: number;
  /** Added to the lightness, which runs from 0 (black) to 1 (white). */
  lightness?: number;
}

/** The same colour a little further round the colour wheel, greyer or stronger, darker or lighter. */
export function shade(hex: string, change: Shade): string {
  const [red, green, blue] = parse(hex).map((value) => value / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const spread = max - min;
  let lightness = (max + min) / 2;
  let saturation = spread === 0 ? 0 : spread / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (spread !== 0) {
    if (max === red) hue = ((green - blue) / spread) % 6;
    else if (max === green) hue = (blue - red) / spread + 2;
    else hue = (red - green) / spread + 4;
    hue *= 60;
  }

  hue = (((hue + (change.hue ?? 0)) % 360) + 360) % 360;
  saturation = Math.min(1, Math.max(0, saturation * (change.saturation ?? 1)));
  lightness = Math.min(1, Math.max(0, lightness + (change.lightness ?? 0)));

  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const base = lightness - chroma / 2;
  const sector = Math.floor(hue / 60);
  const [r, g, b] =
    sector === 0
      ? [chroma, second, 0]
      : sector === 1
        ? [second, chroma, 0]
        : sector === 2
          ? [0, chroma, second]
          : sector === 3
            ? [0, second, chroma]
            : sector === 4
              ? [second, 0, chroma]
              : [chroma, 0, second];
  return format([(r + base) * 255, (g + base) * 255, (b + base) * 255]);
}
