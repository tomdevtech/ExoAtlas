import Link from "next/link";

/** Shown for unknown URLs and when a page calls `notFound()`. */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-start gap-4 px-6 py-14">
      <h1 className="text-3xl font-semibold tracking-tight">Nothing here</h1>
      <p className="max-w-xl leading-7 text-muted">
        There is no page at this address. The planet or star may be spelled differently in the
        catalogue: try the search field above.
      </p>
      <Link href="/" className="text-accent underline-offset-4 underline decoration-current/40 hover:decoration-current">
        Back to the start page
      </Link>
    </main>
  );
}
