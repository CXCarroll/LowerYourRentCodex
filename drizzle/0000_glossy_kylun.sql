CREATE TYPE "public"."apt_type" AS ENUM('studio', '1br', '2br', '3br', '4br_plus');--> statement-breakpoint
CREATE TABLE "acs_rent" (
	"year" integer NOT NULL,
	"geo_level" text NOT NULL,
	"geo_id" text NOT NULL,
	"median_gross_rent_cents" integer NOT NULL,
	"sample_size" integer,
	CONSTRAINT "acs_rent_year_geo_level_geo_id_pk" PRIMARY KEY("year","geo_level","geo_id")
);
--> statement-breakpoint
CREATE TABLE "hud_fmr" (
	"year" integer NOT NULL,
	"county_fips" char(5) NOT NULL,
	"apt_type" "apt_type" NOT NULL,
	"fmr_cents" integer NOT NULL,
	CONSTRAINT "hud_fmr_year_county_fips_apt_type_pk" PRIMARY KEY("year","county_fips","apt_type")
);
--> statement-breakpoint
CREATE TABLE "phone_rate_limits" (
	"phone_hash" text PRIMARY KEY NOT NULL,
	"otp_requests_in_window" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"last_otp_sent_at" timestamp with time zone,
	"last_submission_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_address" text NOT NULL,
	"address_hash" text NOT NULL,
	"zip" char(5) NOT NULL,
	"county_fips" char(5),
	"cbsa_code" char(5),
	"apt_type" "apt_type" NOT NULL,
	"rent_cents" integer NOT NULL,
	"lease_expiry" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vacancy_rates" (
	"year" integer NOT NULL,
	"quarter" integer NOT NULL,
	"cbsa_code" char(5) NOT NULL,
	"rental_vacancy_pct" numeric(4, 2) NOT NULL,
	CONSTRAINT "vacancy_rates_year_quarter_cbsa_code_pk" PRIMARY KEY("year","quarter","cbsa_code")
);
--> statement-breakpoint
CREATE TABLE "zip_county" (
	"zip" char(5) PRIMARY KEY NOT NULL,
	"county_fips" char(5) NOT NULL,
	"cbsa_code" char(5)
);
--> statement-breakpoint
CREATE INDEX "submissions_zip_apt_idx" ON "submissions" USING btree ("zip","apt_type");--> statement-breakpoint
CREATE INDEX "submissions_cbsa_apt_idx" ON "submissions" USING btree ("cbsa_code","apt_type");--> statement-breakpoint
CREATE INDEX "submissions_addr_apt_idx" ON "submissions" USING btree ("address_hash","apt_type");--> statement-breakpoint
CREATE INDEX "submissions_created_at_idx" ON "submissions" USING btree ("created_at");