import { describe, expect, it } from "vitest";
import { READONLY_ROLE, readonlyRoleStatements, withRole } from "@/db/readonly";

const PASSWORD = "abcdefghijklmnopqrstuvwxyz_-0123";

describe("readonlyRoleStatements", () => {
  const statements = readonlyRoleStatements("neondb", PASSWORD).join("\n");

  it("only grants reading", () => {
    expect(statements).toContain(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${READONLY_ROLE}`);
    expect(statements).toContain("default_transaction_read_only = on");
    expect(statements).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)/);
  });

  it("names no attribute that only a superuser may set", () => {
    // Neon's owner role is no superuser; naming these fails there.
    expect(statements).not.toMatch(/SUPERUSER|CREATEDB|CREATEROLE/);
  });

  it("limits how long a query may run", () => {
    expect(statements).toContain("statement_timeout = '5s'");
  });

  it("covers the tables of later migrations", () => {
    expect(statements).toContain("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES");
  });

  it("quotes the name of the database", () => {
    expect(readonlyRoleStatements('my"db', PASSWORD).join("\n")).toContain('ON DATABASE "my""db"');
  });

  it("refuses passwords that are short or could break out of the quotes", () => {
    expect(() => readonlyRoleStatements("neondb", "short")).toThrow();
    expect(() => readonlyRoleStatements("neondb", `${PASSWORD}'; DROP TABLE planets; --`)).toThrow();
  });
});

describe("withRole", () => {
  it("swaps the owner for the read-only role and keeps the rest", () => {
    const url = withRole(
      "postgres://owner:secret@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require",
      PASSWORD,
    );
    const parsed = new URL(url);
    expect(parsed.username).toBe(READONLY_ROLE);
    expect(parsed.password).toBe(PASSWORD);
    expect(parsed.host).toBe("ep-x-pooler.eu-central-1.aws.neon.tech");
    expect(parsed.pathname).toBe("/neondb");
    expect(parsed.searchParams.get("sslmode")).toBe("require");
  });
});
