import { ImageBitmapLoader } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * picture.ts runs in the browser, so these tests stub fetch,
 * createImageBitmap and a canvas that returns fixed pixels.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

/** Fakes a browser whose picture is `size` × `size` pixels, each made of the given bytes. */
function fakeBrowser(size: number, pixel: number[], { ok = true, context = true } = {}) {
  const bitmap = { close: vi.fn() };
  const decode = vi.fn(async () => bitmap);
  const drawn: unknown[] = [];
  const bytes = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) bytes.set(pixel, i * 4);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status: ok ? 200 : 404, blob: async () => "the file" })));
  vi.stubGlobal("createImageBitmap", decode);
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () =>
        context
          ? { drawImage: (image: unknown) => drawn.push(image), getImageData: () => ({ data: bytes }) }
          : null,
    }),
  });
  return { bitmap, decode, drawn, bytes };
}

describe("loadPicture", () => {
  it("decodes the picture shrunk to the size asked for, beside the page", async () => {
    const browser = fakeBrowser(4, [255, 128, 0, 255]);
    const { loadPicture } = await import("@/app/map/scene/picture");
    const picture = await loadPicture("/textures/sky/galaxy.jpg", 4);
    expect(fetch).toHaveBeenCalledWith("/textures/sky/galaxy.jpg");
    expect(browser.decode).toHaveBeenCalledWith("the file", { resizeWidth: 4, resizeHeight: 4, resizeQuality: "high" });
    expect(browser.drawn).toEqual([browser.bitmap]);
    // The decoded bitmap must be released at once to free its memory.
    expect(browser.bitmap.close).toHaveBeenCalled();
    expect(picture.size).toBe(4);
    expect(picture.bytes).toBe(browser.bytes);
  });

  it("turns the bytes into linear light, red, green and blue", async () => {
    fakeBrowser(2, [255, 128, 0, 255]);
    const { loadPicture } = await import("@/app/map/scene/picture");
    const { linear } = await loadPicture("/picture.jpg", 2);
    expect(linear).toHaveLength(2 * 2 * 3);
    for (let i = 0; i < 4; i++) {
      expect(linear[i * 3]).toBeCloseTo(1, 6);
      expect(linear[i * 3 + 1]).toBeCloseTo((128 / 255) ** 2.2, 6);
      expect(linear[i * 3 + 2]).toBe(0);
    }
  });

  it("fails when the file is not there or the browser cannot draw", async () => {
    fakeBrowser(2, [0, 0, 0, 255], { ok: false });
    const { loadPicture } = await import("@/app/map/scene/picture");
    await expect(loadPicture("/missing.jpg", 2)).rejects.toThrow("/missing.jpg answered with status 404");
    vi.resetModules();
    fakeBrowser(2, [0, 0, 0, 255], { context: false });
    const again = await import("@/app/map/scene/picture");
    await expect(again.loadPicture("/picture.jpg", 2)).rejects.toThrow("No 2D canvas");
  });
});

describe("loadTexture", () => {
  it("decodes pictures upside down and with their numbers untouched", async () => {
    const options = vi.spyOn(ImageBitmapLoader.prototype, "setOptions");
    await import("@/app/map/scene/picture");
    // Planet maps hold heights rather than colours, so no conversion may change their values.
    expect(options).toHaveBeenCalledWith({ imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none" });
  });

  it("hands out the texture at once and gives it its picture when it is decoded", async () => {
    let finish: (bitmap: unknown) => void = () => {};
    let fail: (error: unknown) => void = () => {};
    const load = vi.spyOn(ImageBitmapLoader.prototype, "load").mockImplementation((_url, onLoad, _onProgress, onError) => {
      finish = onLoad as (bitmap: unknown) => void;
      fail = onError as (error: unknown) => void;
      return undefined as never;
    });
    const { loadTexture } = await import("@/app/map/scene/picture");
    const loaded = vi.fn();
    const failed = vi.fn();
    const texture = loadTexture("/textures/sky/milky-way-lg.jpg", loaded, failed);
    expect(load.mock.calls[0][0]).toBe("/textures/sky/milky-way-lg.jpg");
    // The bitmap is already flipped while decoding, so WebGL must not flip it again.
    expect(texture.flipY).toBe(false);
    expect(loaded).not.toHaveBeenCalled();
    const version = texture.version;

    const bitmap = { width: 8, height: 4 };
    finish(bitmap);
    expect(texture.image).toBe(bitmap);
    // Setting needsUpdate raises the version, which tells three.js to upload the texture.
    expect(texture.version).toBe(version + 1);
    expect(loaded).toHaveBeenCalledWith(texture);
    expect(failed).not.toHaveBeenCalled();

    fail(new Error("gone"));
    expect(failed).toHaveBeenCalledTimes(1);
  });
});
