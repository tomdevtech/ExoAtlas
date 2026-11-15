/**
 * Creates our solar system: the Sun and its eight planets.
 *
 *   npm run seed:sol
 *
 * The data and the logic live in src/app/solar-system. This file only starts it.
 */
import { seedSolarSystem } from "@/app/solar-system/seed";
import { closeDb } from "@/db/client";

async function main() {
  try {
    const count = await seedSolarSystem();
    console.log(`Solar system stored: the Sun and ${count} planets.`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

main();
