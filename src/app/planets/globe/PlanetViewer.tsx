"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { GlobeRenderer } from "./renderer";
import { globeRadius, type GlobeSpec } from "./spec";
import { surfaceDefines } from "./uniforms";

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
/** Stops just short of looking straight down on a pole, where left and right would flip. */
const MAX_PITCH = 1.45;
const MAX_PIXEL_RATIO = 2;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** What the drawing loop reads. It changes many times per second, so it is not React state. */
interface View {
  yaw: number;
  pitch: number;
  zoom: number;
  /** The zoom glides towards this value. */
  targetZoom: number;
  seconds: number;
  paused: boolean;
  /** Something changed, so a paused picture has to be drawn again. */
  dirty: boolean;
}

/**
 * The 3D model of a planet: it turns by itself, can be turned by hand to see
 * every side including the night side, and can be zoomed into.
 *
 * `children` is the still image. It shows until the first picture is drawn and
 * stays where WebGL is not available.
 *
 * The model is 280 pixels wide and high (`w-70`, `h-70`). The still image
 * must have the same size.
 */
export function PlanetViewer({
  spec,
  name,
  children,
}: {
  /** The planet as JSON (a GlobeSpec), so the effect only restarts when it changes. */
  spec: string;
  name: string;
  children: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({
    yaw: 0,
    pitch: 0,
    zoom: 1,
    targetZoom: 1,
    seconds: 0,
    paused: false,
    dirty: true,
  });
  /** Fingers or mouse buttons that are down, with their last position. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  const [live, setLive] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  /** The visitor's own choice. Until they make one, the system setting decides. */
  const [pauseChoice, setPauseChoice] = useState<boolean | null>(null);
  const reducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
  const paused = pauseChoice ?? reducedMotion;

  useEffect(() => {
    view.current.paused = paused;
  }, [paused]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const state = view.current;
    const globe: GlobeSpec = JSON.parse(spec);
    const pixelSize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      return {
        width: Math.round(element.clientWidth * ratio),
        height: Math.round(element.clientHeight * ratio),
      };
    };
    // Sized before the context exists: a resize while the shader is still
    // being built would wait for it and freeze the page.
    const initial = pixelSize();
    element.width = initial.width;
    element.height = initial.height;
    const renderer = GlobeRenderer.create(element, "lg", () => {
      state.dirty = true;
    });
    if (!renderer) return;
    // Starts building the shader now, not only once the model is on screen.
    renderer.prepare(surfaceDefines(globe));

    let request = 0;
    let last = 0;
    let shown = false;

    const draw = (now: number) => {
      request = requestAnimationFrame(draw);
      const elapsed = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      if (!state.paused) state.seconds += elapsed;

      const zoomBefore = state.zoom;
      state.zoom += (state.targetZoom - state.zoom) * Math.min(1, elapsed * 12);
      if (Math.abs(state.targetZoom - state.zoom) < 0.002) state.zoom = state.targetZoom;
      if (state.paused && !state.dirty && state.zoom === zoomBefore) return;
      // Resizing the canvas while the shader is being built would freeze the page.
      if (!renderer.ready(globe)) return;

      const { width, height } = pixelSize();
      if (width === 0 || height === 0) return;
      if (element.width !== width || element.height !== height) {
        element.width = width;
        element.height = height;
      }

      const drawn = renderer.draw(
        globe,
        { seconds: state.seconds, yaw: state.yaw, pitch: state.pitch, zoom: state.zoom, flow: true },
        { x: 0, y: 0, width, height },
      );
      state.dirty = !drawn;
      if (drawn && !shown) {
        shown = true;
        setLive(true);
      }
    };

    // Draw only while the model is on screen.
    const observer = new IntersectionObserver(([entry]) => {
      cancelAnimationFrame(request);
      request = 0;
      if (entry.isIntersecting) {
        last = 0;
        state.dirty = true;
        request = requestAnimationFrame(draw);
      }
    });
    observer.observe(element);

    // A changed size empties the canvas, so a paused picture is drawn again.
    const resizes = new ResizeObserver(() => {
      state.dirty = true;
    });
    resizes.observe(element);

    // The wheel zooms in full screen, or with Ctrl. Otherwise it scrolls the page as usual.
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && document.fullscreenElement !== frame.current) return;
      event.preventDefault();
      state.targetZoom = clampZoom(state.targetZoom * Math.exp(-event.deltaY * 0.0015));
    };
    element.addEventListener("wheel", onWheel, { passive: false });

    const onFullscreenChange = () => {
      setFullscreen(document.fullscreenElement === frame.current);
      state.dirty = true;
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);

    return () => {
      cancelAnimationFrame(request);
      observer.disconnect();
      resizes.disconnect();
      element.removeEventListener("wheel", onWheel);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      renderer.dispose();
    };
  }, [spec]);

  /** Turning by one planet radius on screen turns the view by one radian. */
  function radiansPerPixel(): number {
    const element = canvas.current;
    if (!element) return 0.01;
    const globe: GlobeSpec = JSON.parse(spec);
    const radius =
      (Math.min(element.clientWidth, element.clientHeight) / 2) *
      globeRadius(globe) *
      view.current.zoom;
    return 1 / Math.max(radius, 40);
  }

  function turn(yaw: number, pitch: number) {
    const state = view.current;
    state.yaw += yaw;
    state.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, state.pitch + pitch));
    state.dirty = true;
  }

  function zoomBy(factor: number) {
    view.current.targetZoom = clampZoom(view.current.targetZoom * factor);
  }

  function reset() {
    const state = view.current;
    state.yaw = 0;
    state.pitch = 0;
    state.targetZoom = 1;
    state.dirty = true;
  }

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const before = pointers.current.get(event.pointerId);
    if (!before) return;
    const now = { x: event.clientX, y: event.clientY };

    if (pointers.current.size === 1) {
      const scale = radiansPerPixel();
      turn((now.x - before.x) * scale, (now.y - before.y) * scale);
    } else if (pointers.current.size === 2) {
      // Two fingers: the change of their distance zooms.
      const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId);
      if (other) {
        const distanceBefore = Math.hypot(before.x - other[1].x, before.y - other[1].y);
        const distanceNow = Math.hypot(now.x - other[1].x, now.y - other[1].y);
        if (distanceBefore > 0) {
          const state = view.current;
          state.targetZoom = clampZoom(state.targetZoom * (distanceNow / distanceBefore));
          state.zoom = state.targetZoom;
          state.dirty = true;
        }
      }
    }
    pointers.current.set(event.pointerId, now);
  }

  function onPointerEnd(event: PointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(event.pointerId);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Keys pressed on one of the buttons belong to that button.
    if (event.target !== event.currentTarget) return;
    const step = 0.2 / view.current.zoom;
    if (event.key === "ArrowLeft") turn(-step, 0);
    else if (event.key === "ArrowRight") turn(step, 0);
    else if (event.key === "ArrowUp") turn(0, -step);
    else if (event.key === "ArrowDown") turn(0, step);
    else if (event.key === "+" || event.key === "=") zoomBy(1.4);
    else if (event.key === "-") zoomBy(1 / 1.4);
    else if (event.key === "0") reset();
    else return;
    event.preventDefault();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frame.current?.requestFullscreen().catch(() => {});
  }

  const canFullscreen = live && typeof document !== "undefined" && document.fullscreenEnabled;
  const button =
    "rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-muted transition-colors hover:text-foreground";

  return (
    <div
      ref={frame}
      tabIndex={live ? 0 : undefined}
      role="group"
      aria-label={`3D model of ${name}. Arrow keys turn it, plus and minus zoom, zero resets.`}
      onKeyDown={onKeyDown}
      className={`flex shrink-0 flex-col items-center gap-3 rounded-xl bg-background outline-none focus-visible:ring-1 focus-visible:ring-accent ${fullscreen ? "p-4" : "w-70"}`}
    >
      <div className={`relative w-full ${fullscreen ? "min-h-0 flex-1" : "h-70"}`}>
        <div
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-500 ${live ? "opacity-0" : "opacity-100"}`}
        >
          {children}
        </div>
        <canvas
          ref={canvas}
          aria-hidden
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          // Outside full screen a vertical swipe still scrolls the page (touch-pan-y).
          className={`absolute inset-0 h-full w-full cursor-grab transition-opacity duration-500 active:cursor-grabbing ${live ? "opacity-100" : "opacity-0"} ${fullscreen ? "touch-none" : "touch-pan-y"}`}
        />
      </div>

      {/* Always there, so the page does not jump when the model appears. */}
      <div className={`flex flex-wrap justify-center gap-1.5 ${live ? "" : "invisible"}`}>
          <button type="button" className={button} aria-label="Zoom out" onClick={() => zoomBy(1 / 1.5)}>
            −
          </button>
          <button type="button" className={button} aria-label="Zoom in" onClick={() => zoomBy(1.5)}>
            +
          </button>
          <button type="button" className={button} onClick={reset}>
            Reset
          </button>
          <button type="button" className={button} onClick={() => setPauseChoice(!paused)}>
            {paused ? "Spin" : "Pause"}
          </button>
          {canFullscreen && (
            <button type="button" className={button} onClick={toggleFullscreen}>
              {fullscreen ? "Close" : "Full screen"}
            </button>
          )}
      </div>
    </div>
  );
}

function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}
