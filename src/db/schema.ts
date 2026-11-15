import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const id = () => integer("id").primaryKey().generatedAlwaysAsIdentity();
const nowColumn = (name: string) =>
  timestamp(name, { withTimezone: true }).notNull().defaultNow();

/** A star with at least one planet in the catalogue, plus the Sun. */
export const stars = pgTable(
  "stars",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull().unique(),
    /** The name in lower case without spaces or punctuation. The search runs on this. */
    searchName: text("search_name").notNull(),
    /** `nasa` rows are maintained by the sync, `sol` rows are our solar system. */
    source: text("source", { enum: ["nasa", "sol"] }).notNull(),
    hip: text("hip"),
    hd: text("hd"),
    gaiaId: text("gaia_id"),
    ra: doublePrecision("ra"),
    dec: doublePrecision("dec"),
    distPc: doublePrecision("dist_pc"),
    /** Galactic coordinates in parsecs with the Sun at the origin. Precomputed for the map. */
    x: doublePrecision("x"),
    y: doublePrecision("y"),
    z: doublePrecision("z"),
    spectralType: text("spectral_type"),
    teffK: doublePrecision("teff_k"),
    radiusSun: doublePrecision("radius_sun"),
    massSun: doublePrecision("mass_sun"),
    vmag: doublePrecision("vmag"),
    /** Number of active planets. Recounted after every sync. */
    planetCount: integer("planet_count").notNull().default(0),
    updatedAt: nowColumn("updated_at"),
  },
  (t) => [
    index("stars_search_trgm").using("gin", t.searchName.op("gin_trgm_ops")),
  ],
);

/** A planet: exoplanets from NASA and the eight planets of the solar system. */
export const planets = pgTable(
  "planets",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull().unique(),
    searchName: text("search_name").notNull(),
    starId: integer("star_id")
      .notNull()
      .references(() => stars.id),
    source: text("source", { enum: ["nasa", "sol"] }).notNull(),
    /** `removed`: NASA no longer lists the planet. The row stays for its history. */
    status: text("status", { enum: ["active", "removed"] })
      .notNull()
      .default("active"),

    discoveryMethod: text("discovery_method"),
    discoveryYear: integer("discovery_year"),
    discoveryFacility: text("discovery_facility"),

    orbitalPeriodDays: doublePrecision("orbital_period_days"),
    semiMajorAxisAu: doublePrecision("semi_major_axis_au"),
    eccentricity: doublePrecision("eccentricity"),

    // Each value carries a flag that says whether NASA only calculated it.
    radiusEarth: doublePrecision("radius_earth"),
    radiusCalculated: boolean("radius_calculated").notNull().default(false),
    massEarth: doublePrecision("mass_earth"),
    massCalculated: boolean("mass_calculated").notNull().default(false),
    /** Only a minimum mass (M·sin i) is known. */
    massIsMinimum: boolean("mass_is_minimum").notNull().default(false),
    density: doublePrecision("density"),
    densityCalculated: boolean("density_calculated").notNull().default(false),
    eqTempK: doublePrecision("eq_temp_k"),
    eqTempCalculated: boolean("eq_temp_calculated").notNull().default(false),
    insolation: doublePrecision("insolation"),
    insolationCalculated: boolean("insolation_calculated")
      .notNull()
      .default(false),

    /** Derived in src/app/planets/classify.ts. Drives the image and the filters. */
    planetClass: text("planet_class", {
      enum: ["rocky", "super_earth", "neptune_like", "gas_giant"],
    }),
    climateClass: text("climate_class", {
      enum: ["frozen", "cold", "temperate", "hot", "scorching"],
    }),

    /** Hash of the tracked values. When it changes, the sync records the change history. */
    dataHash: text("data_hash").notNull(),
    firstSeenAt: nowColumn("first_seen_at"),
    updatedAt: nowColumn("updated_at"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [
    index("planets_star_idx").on(t.starId),
    index("planets_search_trgm").using("gin", t.searchName.op("gin_trgm_ops")),
    index("planets_class_idx").on(t.planetClass),
    index("planets_year_idx").on(t.discoveryYear),
  ],
);

/** Former names of a star, so old URLs can redirect. */
export const starAliases = pgTable("star_aliases", {
  id: id(),
  starId: integer("star_id")
    .notNull()
    .references(() => stars.id),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: nowColumn("created_at"),
});

/** Former names of a planet, so old URLs can redirect. */
export const planetAliases = pgTable("planet_aliases", {
  id: id(),
  planetId: integer("planet_id")
    .notNull()
    .references(() => planets.id),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: nowColumn("created_at"),
});

/** One row per sync run, including failed ones. */
export const syncRuns = pgTable("sync_runs", {
  id: id(),
  startedAt: nowColumn("started_at"),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status", { enum: ["running", "success", "failed"] })
    .notNull()
    .default("running"),
  rowsFetched: integer("rows_fetched"),
  added: integer("added").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  unchanged: integer("unchanged").notNull().default(0),
  removed: integer("removed").notNull().default(0),
  renamed: integer("renamed").notNull().default(0),
  error: text("error"),
});

/** Change history: one row per changed value. */
export const planetChanges = pgTable(
  "planet_changes",
  {
    id: id(),
    planetId: integer("planet_id")
      .notNull()
      .references(() => planets.id),
    syncRunId: integer("sync_run_id")
      .notNull()
      .references(() => syncRuns.id),
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    changedAt: nowColumn("changed_at"),
  },
  (t) => [index("planet_changes_planet_idx").on(t.planetId, t.changedAt)],
);

export type Star = typeof stars.$inferSelect;
export type Planet = typeof planets.$inferSelect;
