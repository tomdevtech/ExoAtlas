import { closeDb } from "@/db/client";
import { e2eDatabaseUrl, prepareTestDatabase } from "@tests/support/db";

/** Runs once before the browser tests and seeds the database that the app under test reads. */
export default async function globalSetup() {
  await prepareTestDatabase(e2eDatabaseUrl());
  await closeDb();
}
