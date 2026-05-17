CREATE TABLE "email_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verified_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_hash" text NOT NULL,
	"first_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verify_count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "verified_emails_email_hash_unique" UNIQUE("email_hash")
);
--> statement-breakpoint
CREATE INDEX "email_verifications_email_hash_idx" ON "email_verifications" USING btree ("email_hash");--> statement-breakpoint
CREATE INDEX "email_verifications_expires_idx" ON "email_verifications" USING btree ("expires_at");