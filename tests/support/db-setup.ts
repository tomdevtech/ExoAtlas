import { afterAll } from "vitest";
import { closeDb } from "@/db/client";
import { assertTestDatabase, testDatabaseUrl } from "@tests/support/db";

// Runs before each database test file. getDb() reads DATABASE_URL on its
// first call, so setting it here sends every query of the app to the test database.
const url = testDatabaseUrl();
assertTestDatabase(url);
process.env.DATABASE_URL = url;

afterAll(async () => {
  await closeDb();
});
