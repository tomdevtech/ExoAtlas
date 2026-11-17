import { test as base, expect, type Locator } from "@playwright/test";

/**
 * Extends `test` so that a test fails when the page logs an error, throws an
 * uncaught exception or violates the Content Security Policy. This catches
 * hydration errors and blocked requests even when the page still looks right.
 */
export const test = base.extend<{
  /** Console errors matching this pattern are expected, for example a deliberate 404. It matches nothing by default. */
  allowedErrors: RegExp;
  pageProblems: string[];
}>({
  allowedErrors: [/(?!)/, { option: true }],
  pageProblems: [
    async ({ page, allowedErrors }, use) => {
      const problems: string[] = [];
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          console.error(
            `CSP violation: ${event.violatedDirective} blocked ${event.blockedURI || "inline code"}`,
          );
        });
      });
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (!allowedErrors.test(text)) problems.push(text);
      });
      page.on("pageerror", (error) => {
        if (!allowedErrors.test(error.message)) problems.push(`Uncaught: ${error.message}`);
      });
      await use(problems);
      expect(problems, "errors in the browser console").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Types into a field that only works after hydration and waits for `until`.
 * Text typed before hydration is lost when React takes over the field, so the
 * typing is retried until it takes effect.
 */
export async function typeUntil(field: Locator, text: string, until: Locator) {
  await expect(async () => {
    await field.fill("");
    await field.pressSequentially(text, { delay: 20 });
    await expect(until).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/** Waits until the 3D planet is drawn, which is when its buttons appear. */
export async function waitForGlobe(page: import("@playwright/test").Page) {
  await expect(page.getByRole("button", { name: "Reset" })).toBeVisible({ timeout: 45_000 });
}
