CREATE TABLE "admin_upload_staging" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_token_hash" text NOT NULL,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"file_sha256" text NOT NULL,
	"parsed_payload" jsonb NOT NULL,
	"row_count" integer NOT NULL,
	"error_count" integer NOT NULL,
	"warning_count" integer NOT NULL,
	"insert_count" integer NOT NULL,
	"update_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "admin_upload_staging_admin_id_idx" ON "admin_upload_staging" USING btree ("admin_token_hash","id");--> statement-breakpoint
CREATE INDEX "admin_upload_staging_expires_idx" ON "admin_upload_staging" USING btree ("expires_at");