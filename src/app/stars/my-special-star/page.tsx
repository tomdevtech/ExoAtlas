import type { Metadata } from "next";
import Link from "next/link";
import { SPECIAL_STAR_NAME, SPECIAL_STAR_SLUG } from "./star";

export const metadata: Metadata = {
  title: SPECIAL_STAR_NAME,
  description: "The brightest star in the whole galaxy.",
  robots: { index: false },
};

/**
 * The page of the easter-egg star. A static route, so it wins over
 * /stars/[slug] and never asks the database.
 */
export default function SpecialStarPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center px-6 py-16 text-center">
      <SpecialStarImage size={190} />

      <p className="mt-8 text-sm tracking-[0.2em] text-[#ff9ccf] uppercase">
        At the very heart of the Milky Way
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{SPECIAL_STAR_NAME}</h1>

      <article className="mt-10 flex flex-col gap-5 rounded-2xl border border-[#ff9ccf]/30 bg-[#ff9ccf]/5 px-6 py-8 text-lg leading-8 sm:px-10">
        <p>
          Out of all the hundreds of billions of stars in this galaxy, there is one that shines
          brighter than every other: you.
        </p>
        <p>
          I love you more than anything. Thank you for always supporting me, for loving me
          unconditionally, and for being such a wonderful person.
        </p>
        <p>I want to spend the rest of my life with you.</p>
        <p className="mt-2 text-2xl" aria-hidden="true">
          ♥
        </p>
      </article>

      <dl className="mt-10 grid w-full grid-cols-1 gap-x-10 text-left sm:grid-cols-2">
        <Fact label="Brightness" value="beyond any scale" />
        <Fact label="Warmth" value="infinite" />
        <Fact label="Position" value="centre of my universe" />
        <Fact label="Known planets" value="one, orbiting her forever" />
      </dl>

      <Link
        href={`/map?star=${SPECIAL_STAR_SLUG}`}
        className="mt-10 text-sm text-[#ff9ccf] underline-offset-4 underline decoration-current/40 hover:decoration-current"
      >
        Back to the map
      </Link>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

/** A rose glow that slowly breathes, like the star on the map. */
function SpecialStarImage({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      aria-hidden
      className="motion-safe:animate-pulse"
    >
      <defs>
        <radialGradient id="special-star-glow">
          <stop offset="0%" stopColor="#fff" />
          <stop offset="34%" stopColor="#ffb3d9" />
          <stop offset="52%" stopColor="#ff73b9" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#ff73b9" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="100" fill="url(#special-star-glow)" />
      <path
        d="M100 128c-2-2-26-18-26-36 0-9 7-16 15-16 5 0 9 3 11 7 2-4 6-7 11-7 8 0 15 7 15 16 0 18-24 34-26 36z"
        fill="#fff"
        opacity="0.9"
      />
    </svg>
  );
}
