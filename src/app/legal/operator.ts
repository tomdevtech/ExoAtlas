/**
 * Details of whoever runs this copy of ExoFinder. The legal notice and the privacy policy must name a person
 * with a postal address; because the code is public, these details come from environment variables (see .env.example).
 */
export interface Operator {
  name: string;
  /** Street and house number. */
  street: string;
  /** Postcode and town. */
  city: string;
  country: string;
  email: string;
  phone: string | null;
  /** Name and address of the company whose servers deliver the site, if there is one. */
  hosting: string | null;
  /**
   * Whether a data processing agreement (Art. 28 GDPR) with the host exists. Only then may the privacy
   * policy say so; Vercel's free Hobby plan, for example, has none.
   */
  hostingContract: boolean;
  /**
   * Legal basis for the host processing data outside the EU, for example an EU-U.S. Data Privacy Framework
   * certification. It is only shown together with `hosting`.
   */
  hostingTransfer: string | null;
  /** The company that receives and stores the operator's e-mails, if it is not the operator. */
  emailProvider: string | null;
  /** Days after which the server deletes its log entries, if known. */
  logDays: number | null;
}

/** The variables a legal notice cannot do without. */
const REQUIRED = ["LEGAL_NAME", "LEGAL_STREET", "LEGAL_CITY", "LEGAL_EMAIL"] as const;

export interface OperatorDetails {
  operator: Operator;
  /** Names of the required variables that are not set. Empty when the details are complete. */
  missing: string[];
}

/** Reads the details from environment variables. A variable that is empty counts as not set. */
export function readOperator(env: Record<string, string | undefined>): OperatorDetails {
  const value = (name: string) => env[name]?.trim() ?? "";
  const optional = (name: string) => value(name) || null;
  const days = value("LEGAL_LOG_DAYS");

  return {
    operator: {
      name: value("LEGAL_NAME"),
      street: value("LEGAL_STREET"),
      city: value("LEGAL_CITY"),
      country: value("LEGAL_COUNTRY") || "Germany",
      email: value("LEGAL_EMAIL"),
      phone: optional("LEGAL_PHONE"),
      hosting: optional("LEGAL_HOSTING"),
      hostingContract: value("LEGAL_HOSTING_DPA").toLowerCase() === "true",
      hostingTransfer: optional("LEGAL_HOSTING_TRANSFER"),
      emailProvider: optional("LEGAL_EMAIL_PROVIDER"),
      logDays: /^\d{1,4}$/.test(days) && Number(days) > 0 ? Number(days) : null,
    },
    missing: REQUIRED.filter((name) => value(name) === ""),
  };
}

/** Returns the operator details of this copy, read from the environment when the pages are built. */
export function getOperator(): OperatorDetails {
  return readOperator(process.env);
}
