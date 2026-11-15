"use client";

import Form from "next/form";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { listHref, type ListSort } from "./paging";

/** Wait this long after the last key press before the list is filtered. */
const DEBOUNCE_MS = 250;

/**
 * The filter field above the list of all planets.
 *
 * The filter lives in the address (`/planets?q=…`), not in this component:
 * typing replaces the address, and the server sends the matching page of the
 * list. That way a filtered list can be shared and reloaded. The field is an
 * ordinary form, so Enter also works before JavaScript has loaded.
 *
 * While the server answers, the form carries `data-pending`, which the page
 * uses to dim the list.
 */
export function PlanetFilter({
  initial = "",
  sort = "name",
  disabled = false,
}: {
  /** The filter from the address. */
  initial?: string;
  /** The order from the address. A new filter keeps it. */
  sort?: ListSort;
  /** For the placeholder that shows until the address is known. */
  disabled?: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [pending, startTransition] = useTransition();

  // Nothing may fire after the component is gone.
  useEffect(() => () => clearTimeout(timer.current), []);

  // Back and forward change the address without any typing. The field follows,
  // unless the visitor is typing in it right now.
  useEffect(() => {
    const field = input.current;
    if (field && document.activeElement !== field) field.value = initial;
  }, [initial]);

  function handleInput(value: string) {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      startTransition(() => {
        // A new filter starts on page 1. `replace` keeps the history free of
        // one entry per key press, and the page stays where it is scrolled to.
        router.replace(listHref(value.trim(), 1, sort), { scroll: false });
      });
    }, DEBOUNCE_MS);
  }

  return (
    <Form
      action="/planets"
      role="search"
      onSubmit={() => clearTimeout(timer.current)}
      data-pending={pending ? "" : undefined}
    >
      <input
        ref={input}
        type="search"
        name="q"
        defaultValue={initial}
        onChange={(event) => handleInput(event.target.value)}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        maxLength={80}
        placeholder="Filter planets by name"
        aria-label="Filter planets by name"
        className="w-full rounded-lg border border-line bg-surface px-5 py-3.5 text-lg text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
      />
      {/* Carries the order along when the form is sent with Enter. */}
      {sort !== "name" && <input type="hidden" name="sort" value={sort} />}
    </Form>
  );
}
