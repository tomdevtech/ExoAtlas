import { describe, expect, it } from "vitest";
import { readOperator } from "./operator";

const complete = {
  LEGAL_NAME: "Ada Example",
  LEGAL_STREET: "Example Street 1",
  LEGAL_CITY: "12345 Example Town",
  LEGAL_EMAIL: "ada@example.org",
};

describe("readOperator", () => {
  it("reads complete details and fills in the country", () => {
    const { operator, missing } = readOperator(complete);
    expect(missing).toEqual([]);
    expect(operator).toEqual({
      name: "Ada Example",
      street: "Example Street 1",
      city: "12345 Example Town",
      country: "Germany",
      email: "ada@example.org",
      phone: null,
      hosting: null,
      hostingContract: false,
      hostingTransfer: null,
      emailProvider: null,
      logDays: null,
    });
  });

  it("names every required variable that is not set or empty", () => {
    expect(readOperator({}).missing).toEqual([
      "LEGAL_NAME",
      "LEGAL_STREET",
      "LEGAL_CITY",
      "LEGAL_EMAIL",
    ]);
    expect(readOperator({ ...complete, LEGAL_EMAIL: "   " }).missing).toEqual(["LEGAL_EMAIL"]);
  });

  it("reads the optional details", () => {
    const { operator } = readOperator({
      ...complete,
      LEGAL_COUNTRY: " Austria ",
      LEGAL_PHONE: "+49 30 000000",
      LEGAL_HOSTING: "Example Hosting GmbH, Server Road 2, 54321 Hosttown, Germany",
      LEGAL_HOSTING_TRANSFER: " The company is certified under a data protection framework. ",
      LEGAL_EMAIL_PROVIDER: "Example Mail Ltd., Mail Lane 3, 12345 Mailtown, Germany",
      LEGAL_LOG_DAYS: "14",
    });
    expect(operator.emailProvider).toBe("Example Mail Ltd., Mail Lane 3, 12345 Mailtown, Germany");
    expect(operator.country).toBe("Austria");
    expect(operator.phone).toBe("+49 30 000000");
    expect(operator.hosting).toBe("Example Hosting GmbH, Server Road 2, 54321 Hosttown, Germany");
    expect(operator.hostingTransfer).toBe(
      "The company is certified under a data protection framework.",
    );
    expect(operator.logDays).toBe(14);
  });

  it("claims a data processing agreement only for LEGAL_HOSTING_DPA=true", () => {
    const contract = (value?: string) =>
      readOperator({ ...complete, LEGAL_HOSTING_DPA: value }).operator.hostingContract;
    expect(contract("true")).toBe(true);
    expect(contract(" TRUE ")).toBe(true);
    expect(contract(undefined)).toBe(false);
    expect(contract("")).toBe(false);
    expect(contract("yes")).toBe(false);
  });

  it("ignores a number of days that is not a whole number above zero", () => {
    for (const days of ["", "0", "-3", "1.5", "two weeks", "99999"]) {
      expect(readOperator({ ...complete, LEGAL_LOG_DAYS: days }).operator.logDays).toBeNull();
    }
  });
});
