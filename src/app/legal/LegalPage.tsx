import type { ReactNode } from "react";
import type { Operator } from "./operator";

/** The frame of the legal notice and the privacy policy: a heading and a column of text. */
export function LegalPage({
  title,
  subtitle,
  missing,
  children,
}: {
  title: string;
  /** The German name of the page, for visitors who look for that word. */
  subtitle: string;
  /** Required details that are not set (see operator.ts). The page then says so instead of hiding it. */
  missing: string[];
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted">{subtitle}</p>
      </header>
      {missing.length > 0 && (
        <p
          role="alert"
          className="max-w-2xl rounded-lg border border-warning/50 bg-warning/10 px-4 py-3 text-sm leading-6 text-warning"
        >
          This page is not complete. Whoever runs this copy of ExoAtlas has not entered their
          details yet. Missing: {missing.join(", ")}. They are set as environment variables, see
          .env.example.
        </p>
      )}
      <div className="flex max-w-2xl flex-col gap-8">{children}</div>
    </main>
  );
}

/** A part of a legal page with its own heading. Paragraphs and lists inside it get their spacing here. */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 leading-7 [&_a]:text-accent [&_a]:underline-offset-4 [&_a]:underline [&_a]:decoration-current/40 [&_a:hover]:decoration-current [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

/** Name and postal address, one part per line. Parts that are not set are left out. */
export function OperatorAddress({ operator }: { operator: Operator }) {
  const { name, street, city, country } = operator;
  const complete = name !== "" && street !== "" && city !== "";
  return (
    <address className="not-italic">
      {[name, street, city, complete ? country : ""]
        .filter((line) => line !== "")
        .map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
    </address>
  );
}

/** The ways to reach the operator. */
export function OperatorContact({ operator }: { operator: Operator }) {
  const { email, phone } = operator;
  if (email === "" && phone === null) return null;
  return (
    <p>
      {email !== "" && (
        <span className="block">
          E-mail: <a href={`mailto:${email}`}>{email}</a>
        </span>
      )}
      {phone !== null && <span className="block">Phone: {phone}</span>}
    </p>
  );
}
