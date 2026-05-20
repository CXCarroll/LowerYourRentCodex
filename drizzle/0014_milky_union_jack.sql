CREATE TABLE "submission_dedupe_keys" (
	"dedupe_hash" text PRIMARY KEY NOT NULL,
	"address_hash" text NOT NULL,
	"unit_hash" text,
	"apt_type" "apt_type" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "submission_dedupe_keys_expires_idx" ON "submission_dedupe_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "submission_dedupe_keys_addr_apt_idx" ON "submission_dedupe_keys" USING btree ("address_hash","apt_type");