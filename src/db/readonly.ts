/**
 * The database role the website reads with (see scripts/create-readonly-role.ts).
 *
 * The website never writes: only the sync and the seed do, with the owner role.
 * A role that may only read limits the damage of a flaw in a query, and the
 * time limit stops a single expensive query from tying up the database.
 */

export const READONLY_ROLE = "exoatlas_web";

/** Longest a single query of the website may run. */
export const STATEMENT_TIMEOUT = "5s";

/**
 * The statements that create the role, or bring an existing one up to date
 * with a new password. Run them as the role that owns the tables and runs the
 * migrations: the default privileges then also cover tables of later
 * migrations.
 */
export function readonlyRoleStatements(database: string, password: string): string[] {
  if (!/^[A-Za-z0-9_-]{24,}$/.test(password)) {
    // The password is written into the statement, so it must not contain quotes.
    throw new Error("The password must be at least 24 letters, digits, _ or -.");
  }
  const role = READONLY_ROLE;
  const db = `"${database.replaceAll('"', '""')}"`;
  return [
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
        CREATE ROLE ${role} LOGIN;
      END IF;
    END $$`,
    // No NOSUPERUSER, NOCREATEDB or NOCREATEROLE: a new role has none of these
    // anyway, and on hosted databases such as Neon the owner is no superuser
    // and may not name them ("permission denied to alter role").
    `ALTER ROLE ${role} WITH LOGIN PASSWORD '${password}'`,
    `ALTER ROLE ${role} SET default_transaction_read_only = on`,
    `ALTER ROLE ${role} SET statement_timeout = '${STATEMENT_TIMEOUT}'`,
    `ALTER ROLE ${role} SET idle_in_transaction_session_timeout = '10s'`,
    `GRANT CONNECT ON DATABASE ${db} TO ${role}`,
    `GRANT USAGE ON SCHEMA public TO ${role}`,
    `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${role}`,
  ];
}

/** The same address with the read-only role and its password instead of the owner. */
export function withRole(url: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = READONLY_ROLE;
  parsed.password = password;
  return parsed.toString();
}
