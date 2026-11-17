import { ImageBitmapLoader, Texture } from "three";

/** The decoded pixels of an image, `size` × `size`, with rows ordered from top to bottom. */
export interface Picture {
  size: number;
  /** RGBA values as stored in the file, from 0 to 255. */
  bytes: Uint8ClampedArray;
  /** RGB values as linear light, from 0 to 1. */
  linear: Float32Array;
}

/** Maps each 8-bit value to linear light (gamma 2.2), which avoids a power call per pixel. */
const LINEAR = Float32Array.from({ length: 256 }, (_, step) => (step / 255) ** 2.2);

/** Fetches an image, resizes it to `size` × `size` while decoding and returns its pixels. */
export async function loadPicture(url: string, size: number): Promise<Picture> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered with status ${response.status}`);
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

// ImageBitmapLoader decodes images off the main thread. TextureLoader decodes an <img> on upload instead,
// which froze the map for about 100 ms on the sky photo. Values are kept unconverted because the planet
// maps hold heights, not colours.
const loader = new ImageBitmapLoader().setOptions({
  imageOrientation: "flipY",
  premultiplyAlpha: "none",
  colorSpaceConversion: "none",
});

/** Works like TextureLoader.load: it returns a texture at once and fills it in when the image is decoded. */
export function loadTexture(url: string, onLoad: (texture: Texture) => void = () => {}, onError: () => void = () => {}): Texture {
  const texture = new Texture();
  // The image is already flipped during decoding, and WebGL ignores flipY for an ImageBitmap anyway.
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
