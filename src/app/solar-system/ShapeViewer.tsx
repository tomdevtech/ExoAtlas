"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import { loadShapeGrid, SHAPE_FRAGMENT, SHAPE_VERTEX, shapeMesh } from "@/app/planets/globe/shape";
import { linearColor } from "@/app/planets/globe/spec";

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const MAX_PITCH = 1.45;
const MAX_PIXEL_RATIO = 2;
/** One turn takes about 40 seconds, as for the planets. */
const SPIN_RATE = (Math.PI * 2) / 40;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

interface View {
  yaw: number;
  pitch: number;
  zoom: number;
  targetZoom: number;
  seconds: number;
  paused: boolean;
  dirty: boolean;
}

/**
 * The interactive 3D model of an irregular body, drawn from its shape model with three.js, which only
 * loads with this component. It works like the planets' model: it turns by itself, drags, zooms with the
 * buttons, two fingers, Ctrl and the wheel, and the keyboard. Light falls from the upper left, as there.
 */
export function ShapeViewer({
  name,
  shapeUrl,
  maxRadius,
  mapUrl,
  color,
}: {
  name: string;
  shapeUrl: string;
  /** The largest radius in radii of the sphere of the same volume. */
  maxRadius: number;
  /** The surface map, or null to draw the body in `color`. */
  mapUrl: string | null;
  color: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ yaw: 0, pitch: 0.25, zoom: 1, targetZoom: 1, seconds: 0, paused: false, dirty: true });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [live, setLive] = useState(false);
  const [failed, setFailed] = useState(false);
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
    let stop = () => {};
    let cancelled = false;

    (async () => {
      const three = await import("three");
      const grid = await loadShapeGrid(shapeUrl);
      if (cancelled) return;
      let renderer: InstanceType<typeof three.WebGLRenderer>;
      try {
        renderer = new three.WebGLRenderer({ canvas: element, antialias: true, alpha: true });
      } catch {
        setFailed(true);
        return;
      }
      const surface = shapeMesh(grid, maxRadius);
      const geometry = new three.BufferGeometry();
      geometry.setAttribute("position", new three.BufferAttribute(surface.positions, 3));
      geometry.setAttribute("normal", new three.BufferAttribute(surface.normals, 3));
      geometry.setAttribute("direction", new three.BufferAttribute(surface.directions, 3));
      geometry.setIndex(new three.BufferAttribute(surface.indices, 1));
      const blank = new three.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
      blank.needsUpdate = true;
      const uniforms = {
        uMapDay: { value: blank as InstanceType<typeof three.Texture> },
        uHasMap: { value: 0 },
        uTint: { value: linearColor(color) },
        uLight: { value: [1, 1, 1] },
        uLightObject: { value: new three.Vector3() },
        uCameraObject: { value: new three.Vector3() },
      };
      const mesh = new three.Mesh(
        geometry,
        new three.RawShaderMaterial({ glslVersion: three.GLSL3, vertexShader: SHAPE_VERTEX, fragmentShader: SHAPE_FRAGMENT, uniforms }),
      );
      const scene = new three.Scene();
      scene.add(mesh);
      const camera = new three.PerspectiveCamera(20, 1, 0.01, 1000);
      // The camera stands far enough back that the body's farthest point fits the picture at zoom 1.
      const fit = (maxRadius * 1.08) / Math.sin((10 * Math.PI) / 180);
      // The star stands to the upper left and slightly in front, as in the planets' model.
      const sunward = new three.Vector3(-0.62, 0.42, 0.66).normalize().multiplyScalar(1000);

      const mapReady = new Promise<void>((resolve) => {
        if (!mapUrl) return resolve();
        new three.TextureLoader().load(
          mapUrl,
          (texture) => {
            texture.wrapS = three.RepeatWrapping;
            texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
            uniforms.uMapDay.value = texture;
            uniforms.uHasMap.value = 1;
            resolve();
          },
          undefined,
          () => resolve(),
        );
      });
      await mapReady;
      if (cancelled) return;

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
        const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
        renderer.setPixelRatio(ratio);
        renderer.setSize(element.clientWidth, element.clientHeight, false);
        camera.aspect = element.clientWidth / Math.max(element.clientHeight, 1);
        camera.updateProjectionMatrix();
        // The body spins about its axis; dragging turns the camera round it.
        mesh.rotation.set(0, state.seconds * SPIN_RATE, 0);
        const distance = fit / state.zoom;
        camera.position.set(
          distance * Math.cos(state.pitch) * Math.sin(state.yaw),
          distance * Math.sin(state.pitch),
          distance * Math.cos(state.pitch) * Math.cos(state.yaw),
        );
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        mesh.updateMatrixWorld();
        // The light keeps its place in the view while the camera turns.
        const light = sunward.clone().applyQuaternion(camera.quaternion);
        mesh.worldToLocal(uniforms.uLightObject.value.copy(light));
        mesh.worldToLocal(uniforms.uCameraObject.value.copy(camera.position));
        renderer.render(scene, camera);
        state.dirty = false;
        if (!shown) {
          shown = true;
          setLive(true);
        }
      };
      const observer = new IntersectionObserver(([entry]) => {
        cancelAnimationFrame(request);
        if (entry.isIntersecting) {
          last = 0;
          state.dirty = true;
          request = requestAnimationFrame(draw);
        }
      });
      observer.observe(element);
      const onWheel = (event: WheelEvent) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        state.targetZoom = clampZoom(state.targetZoom * Math.exp(-event.deltaY * 0.0015));
      };
      element.addEventListener("wheel", onWheel, { passive: false });
      stop = () => {
        cancelAnimationFrame(request);
        observer.disconnect();
        element.removeEventListener("wheel", onWheel);
        geometry.dispose();
        mesh.material.dispose();
        uniforms.uMapDay.value.dispose();
        blank.dispose();
        renderer.dispose();
      };
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });

    return () => {
      cancelled = true;
      stop();
    };
  }, [shapeUrl, maxRadius, mapUrl, color]);

  function turn(yaw: number, pitch: number) {
    const state = view.current;
    state.yaw -= yaw;
    state.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, state.pitch + pitch));
    state.dirty = true;
  }

  function zoomBy(factor: number) {
    view.current.targetZoom = clampZoom(view.current.targetZoom * factor);
  }

  function reset() {
    Object.assign(view.current, { yaw: 0, pitch: 0.25, targetZoom: 1, dirty: true });
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
      const scale = 1 / Math.max(70 * view.current.zoom, 40);
      turn((now.x - before.x) * scale, (now.y - before.y) * scale);
    } else if (pointers.current.size === 2) {
      const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId);
      if (other) {
        const distanceBefore = Math.hypot(before.x - other[1].x, before.y - other[1].y);
        const distanceNow = Math.hypot(now.x - other[1].x, now.y - other[1].y);
        if (distanceBefore > 0) zoomBy(distanceNow / distanceBefore);
      }
    }
    pointers.current.set(event.pointerId, now);
  }

  function onPointerEnd(event: PointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(event.pointerId);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
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

  const button = "rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-muted transition-colors hover:text-foreground";
  return (
    <div
      tabIndex={live ? 0 : undefined}
      role="group"
      aria-label={`3D model of ${name}. Arrow keys turn it, plus and minus zoom, zero resets.`}
      onKeyDown={onKeyDown}
      className="flex w-70 shrink-0 flex-col items-center gap-3 rounded-xl bg-background outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      <div className="relative h-70 w-full">
        <p
          className={`absolute inset-0 flex items-center justify-center text-center text-sm text-muted transition-opacity duration-500 ${live ? "opacity-0" : "opacity-100"}`}
        >
          {failed ? `This browser cannot draw the 3D model of ${name}.` : `Loading the shape of ${name}…`}
        </p>
        <canvas
          ref={canvas}
          aria-hidden
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          className={`absolute inset-0 h-full w-full cursor-grab touch-pan-y transition-opacity duration-500 active:cursor-grabbing ${live ? "opacity-100" : "opacity-0"}`}
        />
      </div>
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
      </div>
    </div>
  );
}

function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}
