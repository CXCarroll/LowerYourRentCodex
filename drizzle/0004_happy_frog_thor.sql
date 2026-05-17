CREATE TABLE "cbsa_population" (
	"year" integer NOT NULL,
	"cbsa_code" char(5) NOT NULL,
	"population" integer NOT NULL,
	CONSTRAINT "cbsa_population_year_cbsa_code_pk" PRIMARY KEY("year","cbsa_code")
);
