const LIGHT_YEARS_PER_PARSEC = 3.26156;

export function parsecToLightYears(parsec: number): number {
  return parsec * LIGHT_YEARS_PER_PARSEC;
}

export function kelvinToCelsius(kelvin: number): number {
  return kelvin - 273.15;
}

const integer = new Intl.NumberFormat("en-US");

/** Formats a whole number with thousands separators, so 6470 becomes "6,470". */
export function formatCount(value: number): string {
  return integer.format(value);
}

/**
 * Formats a number with about three significant digits: 1234.5 becomes "1,235", 12.345 becomes "12.3"
 * and 0.01234 becomes "0.0123".
 */
export function formatNumber(value: number): string {
  const abs = Math.abs(value);
  const options: Intl.NumberFormatOptions =
    abs >= 100
      ? { maximumFractionDigits: 0 }
      : abs >= 1
        ? { maximumFractionDigits: abs >= 10 ? 1 : 2 }
        : { maximumSignificantDigits: 3 };
  return new Intl.NumberFormat("en-US", options).format(value);
}

// Dates are shown in UTC so every visitor and every server prints the same text.
const dateFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeZone: "UTC",
});

const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "UTC",
});

/** Formats a date in UTC, for example "November 14, 2026". */
export function formatDate(date: Date): string {
  return dateFormat.format(date);
}

/** Formats a date and time in UTC, for example "November 14, 2026 at 7:53 PM UTC". */
export function formatDateTime(date: Date): string {
  return `${dateTimeFormat.format(date)} UTC`;
}

/** Formats an orbital period in days, or in years from two years up. */
export function formatPeriod(days: number): string {
  if (days < 730) return `${formatNumber(days)} days`;
  return `${formatNumber(days / 365.25)} years`;
}
