"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";

/**
 * Shown when a page fails while rendering, for example because the database
 * cannot be reached. The header and the footer from the layout stay in place.
 */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-start gap-4 px-6 py-14">
      <h1 className="text-3xl font-semibold tracking-tight">This page could not be loaded</h1>
      <p className="max-w-xl leading-7 text-muted">
        Something went wrong while reading the catalogue. This is usually temporary, for example
        when the database is restarting.
      </p>
      <button
        type="button"
        onClick={() => retry()}
        className="rounded-lg border border-line px-4 py-2 text-sm transition-colors hover:border-accent/60 hover:bg-surface"
      >
        Try again
      </button>
    </main>
  );
}
