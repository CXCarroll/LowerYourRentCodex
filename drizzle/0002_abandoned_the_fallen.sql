CREATE TABLE "zip_centroids" (
	"zip" char(5) PRIMARY KEY NOT NULL,
	"lat" numeric(9, 6) NOT NULL,
	"lng" numeric(9, 6) NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL
);
