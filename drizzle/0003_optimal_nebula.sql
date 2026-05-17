CREATE TABLE "building_permits" (
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"cbsa_code" char(5) NOT NULL,
	"units_1" integer DEFAULT 0 NOT NULL,
	"units_2" integer DEFAULT 0 NOT NULL,
	"units_3_4" integer DEFAULT 0 NOT NULL,
	"units_5_plus" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "building_permits_year_month_cbsa_code_pk" PRIMARY KEY("year","month","cbsa_code")
);
