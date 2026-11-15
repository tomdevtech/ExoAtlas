CREATE TABLE "planet_aliases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "planet_aliases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"planet_id" integer NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planet_aliases_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "planet_changes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "planet_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"planet_id" integer NOT NULL,
	"sync_run_id" integer NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "planets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"search_name" text NOT NULL,
	"star_id" integer NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"discovery_method" text,
	"discovery_year" integer,
	"discovery_facility" text,
	"orbital_period_days" double precision,
	"semi_major_axis_au" double precision,
	"eccentricity" double precision,
	"radius_earth" double precision,
	"radius_calculated" boolean DEFAULT false NOT NULL,
	"mass_earth" double precision,
	"mass_calculated" boolean DEFAULT false NOT NULL,
	"mass_is_minimum" boolean DEFAULT false NOT NULL,
	"density" double precision,
	"density_calculated" boolean DEFAULT false NOT NULL,
	"eq_temp_k" double precision,
	"eq_temp_calculated" boolean DEFAULT false NOT NULL,
	"insolation" double precision,
	"insolation_calculated" boolean DEFAULT false NOT NULL,
	"planet_class" text,
	"climate_class" text,
	"data_hash" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "planets_slug_unique" UNIQUE("slug"),
	CONSTRAINT "planets_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "star_aliases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "star_aliases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"star_id" integer NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "star_aliases_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "stars" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stars_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"search_name" text NOT NULL,
	"source" text NOT NULL,
	"hip" text,
	"hd" text,
	"gaia_id" text,
	"ra" double precision,
	"dec" double precision,
	"dist_pc" double precision,
	"x" double precision,
	"y" double precision,
	"z" double precision,
	"spectral_type" text,
	"teff_k" double precision,
	"radius_sun" double precision,
	"mass_sun" double precision,
	"vmag" double precision,
	"planet_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stars_slug_unique" UNIQUE("slug"),
	CONSTRAINT "stars_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sync_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"rows_fetched" integer,
	"added" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"unchanged" integer DEFAULT 0 NOT NULL,
	"removed" integer DEFAULT 0 NOT NULL,
	"renamed" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "planet_aliases" ADD CONSTRAINT "planet_aliases_planet_id_planets_id_fk" FOREIGN KEY ("planet_id") REFERENCES "public"."planets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planet_changes" ADD CONSTRAINT "planet_changes_planet_id_planets_id_fk" FOREIGN KEY ("planet_id") REFERENCES "public"."planets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planet_changes" ADD CONSTRAINT "planet_changes_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planets" ADD CONSTRAINT "planets_star_id_stars_id_fk" FOREIGN KEY ("star_id") REFERENCES "public"."stars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "star_aliases" ADD CONSTRAINT "star_aliases_star_id_stars_id_fk" FOREIGN KEY ("star_id") REFERENCES "public"."stars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "planet_changes_planet_idx" ON "planet_changes" USING btree ("planet_id","changed_at");--> statement-breakpoint
CREATE INDEX "planets_star_idx" ON "planets" USING btree ("star_id");--> statement-breakpoint
CREATE INDEX "planets_search_trgm" ON "planets" USING gin ("search_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "planets_class_idx" ON "planets" USING btree ("planet_class");--> statement-breakpoint
CREATE INDEX "planets_year_idx" ON "planets" USING btree ("discovery_year");--> statement-breakpoint
CREATE INDEX "stars_search_trgm" ON "stars" USING gin ("search_name" gin_trgm_ops);