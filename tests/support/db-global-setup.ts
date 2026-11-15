import { closeDb } from "@/db/client";
import { prepareTestDatabase, testDatabaseUrl } from "@tests/support/db";

/** Runs once before the database tests: brings the test database into its known state. */
export default async function setup() {
  await prepareTestDatabase(testDatabaseUrl());
  await closeDb();
}
