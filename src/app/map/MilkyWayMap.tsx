"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type FormEvent } from "react";
import { isSpecialStar, SPECIAL_STAR } from "@/app/stars/my-special-star/star";
import { formatNumber, parsecToLightYears } from "@/shared/format";
import type { MapStar, MapStarsPayload, MapSystemPayload } from "./payload";
import { MapEngine } from "./scene/engine";

const PANEL = "rounded-lg border border-line bg-background/80 backdrop-blur";
const BUTTON =
  "rounded-md border border-line bg-surface/80 px-3 py-1.5 text-sm transition-colors hover:border-accent hover:text-accent disabled:opacity-50";
const PRIMARY =
  "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50";
const TEXT_LINK = "text-sm text-accent underline-offset-4 underline decoration-current/40 hover:decoration-current";

/**
 * The map of the Milky Way with everything around it: the panels, the search
 * field and the address bar. The drawing itself is the job of `MapEngine`;
 * this component tells it what to show and listens to what was clicked.
 *
 * The address keeps track of the place, so a view can be linked:
 * `/map?star=trappist-1`, `/map?system=sun&planet=saturn`, `/map?view=galaxy`.
 */
export default function MilkyWayMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<MapEngine | null>(null);

  const [stars, setStars] = useState<MapStar[] | null>(null);
  const [problem, setProblem] = useState<"webgl" | "stars" | null>(null);
  /** Index into `stars` of the marked star. */
  const [selected, setSelected] = useState<number | null>(null);
  /** The system the visitor is in, or null in the galaxy. */
  const [system, setSystem] = useState<MapSystemPayload | null>(null);
  /** Slug of the system that is loading. */
  const [entering, setEntering] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /** Index into `system.planets` of the planet the camera follows. */
  const [planet, setPlanet] = useState<number | null>(null);
  const [paused, setPaused] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  /** Gives the keyboard back to the map, so the flight keys work after a click on a button. */
  const focusMap = () => containerRef.current?.focus({ preventScroll: true });

  async function enterSystem(slug: string, planetSlug: string | null = null) {
    setEntering(slug);
    setFailed(false);
    try {
      const response = await fetch(`/map/systems/${encodeURIComponent(slug)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as MapSystemPayload;
      const index = planetSlug ? payload.planets.findIndex((p) => p.slug === planetSlug) : -1;
      const focus = index >= 0 ? index : null;
      engineRef.current?.showSystem(payload, focus, paused);
      setSystem(payload);
      setPlanet(focus);
    } catch {
      setFailed(true);
    } finally {
      setEntering(null);
    }
  }

  function leaveSystem() {
    engineRef.current?.showGalaxy();
    setSystem(null);
    setPlanet(null);
    focusMap();
  }

  function selectStar(index: number | null, fly = false) {
    engineRef.current?.select(index);
    if (index !== null && fly) engineRef.current?.flyToStar(index);
    setSelected(index);
    setFailed(false);
  }

  function focusPlanet(index: number | null) {
    engineRef.current?.focusPlanet(index);
    setPlanet(index);
  }

  const handleEscape = useEffectEvent(() => {
    if (system) leaveSystem();
    else selectStar(null);
  });

  /** Goes to the place named in the address the page was opened with. */
  const openLink = useEffectEvent((loaded: MapStar[], link: URLSearchParams) => {
    const engine = engineRef.current;
    if (!engine) return;
    const systemSlug = link.get("system");
    const starSlug = systemSlug ?? link.get("star");
    const index = starSlug ? loaded.findIndex((star) => star[0] === starSlug) : -1;
    if (index >= 0) {
      engine.select(index);
      engine.flyToStar(index, true);
      setSelected(index);
    } else if (link.get("view") === "galaxy") {
      engine.flyToOverview(true);
    }
    if (systemSlug) void enterSystem(systemSlug, link.get("planet"));
  });

  // Starts the map once and loads the stars.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const engine = MapEngine.create(container, {
      onSelect: (index) => {
        setSelected(index);
        setFailed(false);
      },
      onFocus: (index) => setPlanet(index),
      onEscape: () => handleEscape(),
    });
    if (!engine) {
      setProblem("webgl");
      return;
    }
    engineRef.current = engine;
    container.focus({ preventScroll: true });

    const link = new URLSearchParams(window.location.search);
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/map/stars");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as MapStarsPayload;
        if (cancelled) return;
        // One more star that no catalogue knows, at the galactic centre.
        const loaded = [...payload.stars, SPECIAL_STAR];
        engine.setStars(loaded);
        setStars(loaded);
        openLink(loaded, link);
      } catch {
        if (!cancelled) setProblem("stars");
      }
    })();

    return () => {
      cancelled = true;
      engineRef.current = null;
      engine.dispose();
    };
  }, []);

  // Keeps the address in step with the place.
  useEffect(() => {
    if (!stars || entering) return;
    const params = new URLSearchParams();
    if (system) {
      params.set("system", system.star.slug);
      if (planet !== null) params.set("planet", system.planets[planet].slug);
    } else if (selected !== null) {
      params.set("star", stars[selected][0]);
    }
    const query = params.toString();
    window.history.replaceState(null, "", query ? `/map?${query}` : "/map");
  }, [stars, entering, system, planet, selected]);

  if (problem === "webgl") {
    return (
      <div className="absolute inset-0 grid place-items-center p-6">
        <div className={`${PANEL} max-w-md p-6`}>
          <h2 className="text-lg font-semibold">The map needs WebGL 2</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            This browser cannot draw 3D graphics, or they are switched off. Every star and planet
            also has its own page: use the search above, or start with{" "}
            <Link className="text-accent underline-offset-4 underline decoration-current/40 hover:decoration-current" href="/stars/sun">
              the solar system
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  const star = stars && selected !== null ? stars[selected] : null;

  return (
    <>
      <div
        ref={containerRef}
        tabIndex={0}
        role="application"
        aria-label={
          system
            ? `3D view of ${system.star.name} and its planets. Drag to turn, scroll to zoom.`
            : "3D map of the Milky Way. Drag to look around, fly with W, A, S and D."
        }
        className="absolute inset-0 outline-none"
      />

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-3 p-3 sm:p-4">
        <div className="flex min-h-0 items-start justify-between gap-3">
          <div className="pointer-events-auto flex max-h-full w-full max-w-xs min-w-0 flex-col gap-3">
            {system ? (
              <SystemPanel
                system={system}
                planet={planet}
                paused={paused}
                onFocus={(index) => {
                  focusPlanet(index);
                  focusMap();
                }}
                onPause={(next) => {
                  engineRef.current?.setPaused(next);
                  setPaused(next);
                }}
                onLeave={leaveSystem}
              />
            ) : (
              <>
                {stars && (
                  <Finder
                    stars={stars}
                    onChoose={(index) => {
                      selectStar(index, true);
                      focusMap();
                    }}
                  />
                )}
                {star && (
                  <StarPanel
                    star={star}
                    entering={entering === star[0]}
                    failed={failed}
                    onFly={() => {
                      engineRef.current?.flyToStar(selected!);
                      focusMap();
                    }}
                    onEnter={() => {
                      // Park the camera next to the star, so the way back out leads there.
                      engineRef.current?.flyToStar(selected!, true);
                      void enterSystem(star[0]);
                    }}
                    onClose={() => {
                      selectStar(null);
                      focusMap();
                    }}
                  />
                )}
                {!stars && problem === null && (
                  <p className={`${PANEL} px-4 py-3 text-sm text-muted`} aria-live="polite">
                    Loading the stars…
                  </p>
                )}
                {problem === "stars" && (
                  <p className={`${PANEL} px-4 py-3 text-sm leading-6`} role="alert">
                    The stars could not be loaded. Is the database running?
                  </p>
                )}
              </>
            )}
          </div>

          {!system && (
            <div className="pointer-events-auto flex shrink-0 flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className={BUTTON}
                onClick={() => {
                  engineRef.current?.flyHome();
                  focusMap();
                }}
              >
                Sun
              </button>
              <button
                type="button"
                className={BUTTON}
                onClick={() => {
                  engineRef.current?.flyToOverview();
                  focusMap();
                }}
              >
                Whole galaxy
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1 text-xs leading-5 text-muted [text-shadow:0_0_4px_#000] sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <p className="hidden max-w-md sm:block">
            {system
              ? "Drag to turn · scroll to zoom · click a planet to follow it · Esc returns to the galaxy. Sizes and distances are not to scale."
              : "Drag to look around · W A S D to fly, E and Q for up and down, Shift for speed · scroll to move forwards · click a star to select it, double-click to fly there."}
          </p>
          <p className="max-w-md sm:hidden">
            {system
              ? "Drag to turn, pinch to zoom, tap a planet. Not to scale."
              : "Drag to look around, pinch to fly, tap a star."}
          </p>
          <p className="pointer-events-auto sm:shrink-0 sm:text-right">
            Sky:{" "}
            <a className="hover:text-foreground" href="https://www.eso.org/public/images/eso0932a/">
              ESO/S. Brunier
            </a>
            {system?.star.isSun && (
              <>
                {" · "}Maps:{" "}
                <a className="hover:text-foreground" href="https://www.solarsystemscope.com/textures/">
                  Solar System Scope
                </a>
              </>
            )}
            {" · "}
            <a className="hover:text-foreground" href="https://creativecommons.org/licenses/by/4.0/">
              CC BY 4.0
            </a>
            <br />
            {system
              ? system.star.isSun
                ? "The planets show real maps of their surfaces."
                : "The surfaces are illustrations computed from the data."
              : "Star positions are measured, the galaxy’s shape is a model."}
            <br />
            {/* The footer of the other pages is hidden on the map, so its legal links stand here. */}
            <Link className="hover:text-foreground" href="/legal/notice">
              Legal notice
            </Link>
            {" · "}
            <Link className="hover:text-foreground" href="/legal/privacy">
              Privacy
            </Link>
          </p>
        </div>
      </div>
    </>
  );
}

function distanceText(parsec: number): string {
  return `${formatNumber(parsecToLightYears(parsec))} light-years from the Sun`;
}

function planetsText(count: number): string {
  return count === 1 ? "1 known planet" : `${count} known planets`;
}

/** A field to find a star by name among the ones on the map. */
function Finder({ stars, onChoose }: { stars: MapStar[]; onChoose: (index: number) => void }) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    if (wanted.length < 2) return [];
    // The stars are sorted by distance: of equal matches, the nearest come first.
    const beginning: number[] = [];
    const inside: number[] = [];
    for (let i = 0; i < stars.length && beginning.length < 8; i++) {
      const name = stars[i][1].toLowerCase();
      if (name.startsWith(wanted)) beginning.push(i);
      else if (inside.length < 8 && name.includes(wanted)) inside.push(i);
    }
    return [...beginning, ...inside].slice(0, 8);
  }, [query, stars]);

  const choose = (index: number) => {
    setQuery("");
    onChoose(index);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (matches.length > 0) choose(matches[0]);
  };

  return (
    <form onSubmit={submit} role="search" className={`${PANEL} shrink-0`}>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Find a star on the map"
        aria-label="Find a star on the map"
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-lg bg-transparent px-4 py-2.5 text-sm outline-none placeholder:text-muted focus-visible:ring-1 focus-visible:ring-accent"
      />
      {matches.length > 0 && (
        <ul className="border-t border-line py-1">
          {matches.map((index) => (
            <li key={stars[index][0]}>
              <button
                type="button"
                onClick={() => choose(index)}
                className="flex w-full items-baseline justify-between gap-3 px-4 py-1.5 text-left text-sm hover:bg-surface"
              >
                <span className="truncate">{stars[index][1]}</span>
                <span className="shrink-0 text-xs text-muted">
                  {isSpecialStar(stars[index][0])
                    ? "Galactic centre"
                    : planetsText(stars[index][6])}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim().length >= 2 && matches.length === 0 && (
        <p className="border-t border-line px-4 py-2 text-sm text-muted">No star with this name.</p>
      )}
    </form>
  );
}

function StarPanel({
  star,
  entering,
  failed,
  onFly,
  onEnter,
  onClose,
}: {
  star: MapStar;
  entering: boolean;
  failed: boolean;
  onFly: () => void;
  onEnter: () => void;
  onClose: () => void;
}) {
  const [slug, name, x, y, z, , planetCount] = star;
  const isSun = slug === "sun";
  if (isSpecialStar(slug)) return <SpecialStarPanel name={name} onFly={onFly} onClose={onClose} />;
  return (
    <section className={`${PANEL} flex flex-col gap-3 p-4`} aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 text-lg leading-6 font-semibold wrap-break-word">{name}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Clear the selection"
          className="-mt-1 -mr-1 shrink-0 rounded px-2 py-1 text-muted hover:text-foreground"
        >
          ✕
        </button>
      </div>
      <p className="text-sm leading-6 text-muted">
        {isSun ? "Our own star" : distanceText(Math.hypot(x, y, z))}
        <br />
        {isSun ? `${planetCount} planets` : planetsText(planetCount)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={PRIMARY} onClick={onEnter} disabled={entering}>
          {entering ? "Loading…" : "Enter system"}
        </button>
        <button type="button" className={BUTTON} onClick={onFly}>
          Fly there
        </button>
        <Link className={`${TEXT_LINK} ml-1`} href={`/stars/${slug}`}>
          Star page
        </Link>
      </div>
      {failed && (
        <p className="text-sm text-warning" role="alert">
          This system could not be loaded.
        </p>
      )}
    </section>
  );
}

/** The panel of the easter-egg star: it has no system to enter, only a message. */
function SpecialStarPanel({
  name,
  onFly,
  onClose,
}: {
  name: string;
  onFly: () => void;
  onClose: () => void;
}) {
  return (
    <section
      className={`${PANEL} flex flex-col gap-3 border-[#ff9ccf]/50 p-4 shadow-[0_0_24px_rgba(255,156,207,0.25)]`}
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 text-lg leading-6 font-semibold wrap-break-word text-[#ff9ccf]">
          {name} ♥
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Clear the selection"
          className="-mt-1 -mr-1 shrink-0 rounded px-2 py-1 text-muted hover:text-foreground"
        >
          ✕
        </button>
      </div>
      <p className="text-sm leading-6 text-muted">
        At the very heart of the Milky Way
        <br />
        The brightest star in the whole galaxy
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/stars/${SPECIAL_STAR[0]}`}
          className="rounded-md bg-[#ff9ccf] px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          Open the info page
        </Link>
        <button type="button" className={BUTTON} onClick={onFly}>
          Fly there
        </button>
      </div>
    </section>
  );
}

function SystemPanel({
  system,
  planet,
  paused,
  onFocus,
  onPause,
  onLeave,
}: {
  system: MapSystemPayload;
  planet: number | null;
  paused: boolean;
  onFocus: (index: number | null) => void;
  onPause: (paused: boolean) => void;
  onLeave: () => void;
}) {
  const { star, planets } = system;
  // On a narrow screen the list would cover the planets, so it folds away there.
  const [listOpen, setListOpen] = useState(false);
  const choose = (index: number | null) => {
    setListOpen(false);
    onFocus(index);
  };
  return (
    <section className={`${PANEL} flex min-h-0 flex-col gap-3 p-4`}>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BUTTON} onClick={onLeave}>
          ← Galaxy
        </button>
        <button type="button" className={BUTTON} onClick={() => onPause(!paused)} aria-pressed={paused}>
          {paused ? "Play orbits" : "Pause orbits"}
        </button>
      </div>
      <div>
        <h2 className="text-lg leading-6 font-semibold wrap-break-word">{star.name}</h2>
        <p className="mt-1 text-sm leading-6 text-muted">
          {star.isSun
            ? "Our own star"
            : star.distPc !== null
              ? distanceText(star.distPc)
              : "At an unknown distance"}
          {" · "}
          <Link className="text-accent underline-offset-4 underline decoration-current/40 hover:decoration-current" href={`/stars/${star.slug}`}>
            Star page
          </Link>
        </p>
      </div>
      <div className="flex items-center gap-3 sm:hidden">
        <button
          type="button"
          className={`${BUTTON} flex min-w-0 flex-1 items-center justify-between gap-2`}
          aria-expanded={listOpen}
          onClick={() => setListOpen(!listOpen)}
        >
          <span className="truncate">{planet === null ? "Whole system" : planets[planet].name}</span>
          <span aria-hidden="true">{listOpen ? "▴" : "▾"}</span>
        </button>
        {planet !== null && (
          <Link className={`${TEXT_LINK} shrink-0`} href={`/planets/${planets[planet].slug}`}>
            Page
          </Link>
        )}
      </div>
      <ul
        className={`-mx-2 min-h-0 flex-col overflow-y-auto sm:flex ${listOpen ? "flex" : "hidden"}`}
      >
        <li>
          <button
            type="button"
            onClick={() => choose(null)}
            aria-pressed={planet === null}
            className={`w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface ${planet === null ? "bg-surface text-foreground" : "text-muted"}`}
          >
            Whole system
          </button>
        </li>
        {planets.map((item, index) => (
          <li key={item.slug}>
            <div
              className={`flex items-center justify-between gap-2 rounded-md hover:bg-surface ${planet === index ? "bg-surface" : ""}`}
            >
              <button
                type="button"
                onClick={() => choose(index)}
                aria-pressed={planet === index}
                className="min-w-0 flex-1 px-2 py-1.5 text-left"
              >
                <span className="block truncate text-sm">{item.name}</span>
                <span className="block truncate text-xs text-muted">{item.description}</span>
              </button>
              {planet === index && (
                <Link className={`${TEXT_LINK} shrink-0 pr-2`} href={`/planets/${item.slug}`}>
                  Page
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
      {planets.length === 0 && (
        <p className="text-sm text-muted">No confirmed planet is listed for this star.</p>
      )}
    </section>
  );
}
