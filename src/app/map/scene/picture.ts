import { ImageBitmapLoader, Texture } from "three";

/** A picture read into numbers, `size` × `size` pixels, rows from the top. */
export interface Picture {
  size: number;
  /** Red, green, blue and opacity as stored in the file, 0 to 255. */
  bytes: Uint8ClampedArray;
  /** Red, green and blue as linear light from 0 to 1. */
  linear: Float32Array;
}

/** Linear light for each of the 256 steps of a picture: a table instead of a power per pixel. */
const LINEAR = Float32Array.from({ length: 256 }, (_, step) => (step / 255) ** 2.2);

/**
 * Reads a picture into numbers. For the plan of the galaxy (starfield.ts),
 * its clouds (galaxyClouds.ts) and its glow, which all need the same small
 * copy of the artist's impression.
 */
export async function loadPicture(url: string, size: number): Promise<Picture> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered with status ${response.status}`);
  // Decoded beside the page and shrunk while it is decoded: no more pixels than asked for are needed.
  const image = await createImageBitmap(await response.blob(), {
    resizeWidth: size,
    resizeHeight: size,
    resizeQuality: "high",
  });
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("No 2D canvas");
  context.drawImage(image, 0, 0);
  image.close();
  const bytes = context.getImageData(0, 0, size, size).data;
  const linear = new Float32Array(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    linear[i * 3] = LINEAR[bytes[i * 4]];
    linear[i * 3 + 1] = LINEAR[bytes[i * 4 + 1]];
    linear[i * 3 + 2] = LINEAR[bytes[i * 4 + 2]];
  }
  return { size, bytes, linear };
}

/**
 * Pictures for the graphics card, decoded beside the page.
 *
 * The TextureLoader of three.js hands the graphics card an <img>, which the
 * browser decodes on the main thread at the moment of the upload: for the
 * photograph of the sky that froze the map for a tenth of a second. An
 * ImageBitmap is decoded in the background before it is handed over. It is
 * turned upside down while it is decoded, as WebGL wants it, and its numbers
 * are kept as they are in the file: the maps of the planets hold heights,
 * not colours.
 */
const loader = new ImageBitmapLoader().setOptions({
  imageOrientation: "flipY",
  premultiplyAlpha: "none",
  colorSpaceConversion: "none",
});

/**
 * A texture that gets its picture once it is decoded, as TextureLoader.load
 * does: it can be handed to a material at once. `onLoad` and `onError` are
 * told when it is there or could not be loaded.
 */
export function loadTexture(url: string, onLoad: (texture: Texture) => void = () => {}, onError: () => void = () => {}): Texture {
  const texture = new Texture();
  // Turned while decoding; WebGL would ignore the flag for an ImageBitmap anyway.
  texture.flipY = false;
  loader.load(
    url,
    (bitmap) => {
      texture.image = bitmap;
      texture.needsUpdate = true;
      onLoad(texture);
    },
    undefined,
    () => onError(),
  );
  return texture;
}
