import {
	pgTable,
	pgEnum,
	uuid,
	text,
	char,
	integer,
	numeric,
	date,
	jsonb,
	timestamp,
	index,
	primaryKey
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const aptType = pgEnum('apt_type', ['studio', '1br', '2br', '3br', '4br_plus']);

// Anonymous submissions. No column links back to a phone.
export const submissions = pgTable(
	'submissions',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		buildingAddress: text('building_address').notNull(),
		addressHash: text('address_hash').notNull(),
		zip: char('zip', { length: 5 }).notNull(),
		countyFips: char('county_fips', { length: 5 }),
		cbsaCode: char('cbsa_code', { length: 5 }),
		aptType: aptType('apt_type').notNull(),
		rentCents: integer('rent_cents').notNull(),
		leaseExpiry: date('lease_expiry').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [
		index('submissions_zip_apt_idx').on(t.zip, t.aptType),
		index('submissions_cbsa_apt_idx').on(t.cbsaCode, t.aptType),
		index('submissions_addr_apt_idx').on(t.addressHash, t.aptType),
		index('submissions_created_at_idx').on(t.createdAt)
	]
);

// Atomic dedupe gate for anonymous submissions. The key is scoped to one
// building, one apartment/unit when supplied, and one apartment-size bucket.
export const submissionDedupeKeys = pgTable(
	'submission_dedupe_keys',
	{
		dedupeHash: text('dedupe_hash').primaryKey(),
		addressHash: text('address_hash').notNull(),
		unitHash: text('unit_hash'),
		aptType: aptType('apt_type').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [
		index('submission_dedupe_keys_expires_idx').on(t.expiresAt),
		index('submission_dedupe_keys_addr_apt_idx').on(t.addressHash, t.aptType)
	]
);

// Seed tables (populated by scripts/seed-*.ts in Phase 2).

export const hudFmr = pgTable(
	'hud_fmr',
	{
		year: integer('year').notNull(),
		countyFips: char('county_fips', { length: 5 }).notNull(),
		aptType: aptType('apt_type').notNull(),
		fmrCents: integer('fmr_cents').notNull()
	},
	(t) => [primaryKey({ columns: [t.year, t.countyFips, t.aptType] })]
);

export const acsRent = pgTable(
	'acs_rent',
	{
		year: integer('year').notNull(),
		geoLevel: text('geo_level').notNull(), // 'zcta' | 'county' | 'tract'
		geoId: text('geo_id').notNull(),
		medianGrossRentCents: integer('median_gross_rent_cents').notNull(),
		sampleSize: integer('sample_size')
	},
	(t) => [primaryKey({ columns: [t.year, t.geoLevel, t.geoId] })]
);

export const vacancyRates = pgTable(
	'vacancy_rates',
	{
		year: integer('year').notNull(),
		quarter: integer('quarter').notNull(),
		cbsaCode: char('cbsa_code', { length: 5 }).notNull(),
		rentalVacancyPct: numeric('rental_vacancy_pct', { precision: 4, scale: 2 }).notNull()
	},
	(t) => [
		primaryKey({ columns: [t.year, t.quarter, t.cbsaCode] }),
		index('vacancy_rates_cbsa_period_idx').on(t.cbsaCode, t.year, t.quarter)
	]
);

// Census Building Permits Survey (BPS) — annual + monthly housing units
// authorized by permit, broken out by structure size. We care primarily
// about `units5plus` (multifamily). `month = 0` denotes an annual-total row;
// 1..12 are monthly rows. Keyed by (year, month, cbsa) so annual + monthly
// coexist without colliding.
export const buildingPermits = pgTable(
	'building_permits',
	{
		year: integer('year').notNull(),
		month: integer('month').notNull(),
		cbsaCode: char('cbsa_code', { length: 5 }).notNull(),
		units1: integer('units_1').notNull().default(0),
		units2: integer('units_2').notNull().default(0),
		units34: integer('units_3_4').notNull().default(0),
		units5plus: integer('units_5_plus').notNull().default(0)
	},
	(t) => [
		primaryKey({ columns: [t.year, t.month, t.cbsaCode] }),
		index('building_permits_cbsa_period_idx').on(t.cbsaCode, t.year, t.month)
	]
);

// Census Population Estimates Program (PEP) — annual CBSA-level population.
// Paired with `building_permits` on the Explore ZIP page so users can see
// whether new supply (permits) is outpacing demand (population growth).
export const cbsaPopulation = pgTable(
	'cbsa_population',
	{
		year: integer('year').notNull(),
		cbsaCode: char('cbsa_code', { length: 5 }).notNull(),
		population: integer('population').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.year, t.cbsaCode] }),
		index('cbsa_population_cbsa_year_idx').on(t.cbsaCode, t.year)
	]
);

export const zipCounty = pgTable('zip_county', {
	zip: char('zip', { length: 5 }).primaryKey(),
	countyFips: char('county_fips', { length: 5 }).notNull(),
	cbsaCode: char('cbsa_code', { length: 5 })
});

// Lazy-populated ZIP → lat/lng cache. Filled on first admin Explore lookup
// via the Census geocoder; subsequent lookups hit this table.
export const zipCentroids = pgTable('zip_centroids', {
	zip: char('zip', { length: 5 }).primaryKey(),
	lat: numeric('lat', { precision: 9, scale: 6 }).notNull(),
	lng: numeric('lng', { precision: 9, scale: 6 }).notNull(),
	resolvedAt: timestamp('resolved_at', { withTimezone: true }).defaultNow().notNull()
});

// Admin — single-admin tool. Sessions stored by sha256 of the cookie token
// so a DB leak can't resurrect live sessions.
export const adminSessions = pgTable(
	'admin_sessions',
	{
		tokenHash: text('token_hash').primaryKey(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [index('admin_sessions_expires_idx').on(t.expiresAt)]
);

// Lightweight audit log of admin CSV uploads. No raw CSV bytes stored.
export const adminUploads = pgTable(
	'admin_uploads',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		kind: text('kind').notNull(), // e.g. 'vacancy_rates'
		filename: text('filename').notNull(),
		fileSha256: text('file_sha256').notNull(),
		rowCount: integer('row_count').notNull(),
		insertCount: integer('insert_count').notNull(),
		updateCount: integer('update_count').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [index('admin_uploads_created_at_idx').on(t.createdAt)]
);

// Durable two-step admin upload staging. Parsed rows live here briefly so
// dry-run and commit can be handled by different app replicas.
export const adminUploadStaging = pgTable(
	'admin_upload_staging',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		adminTokenHash: text('admin_token_hash').notNull(),
		kind: text('kind').notNull(),
		filename: text('filename').notNull(),
		fileSha256: text('file_sha256').notNull(),
		parsedPayload: jsonb('parsed_payload').$type<unknown[]>().notNull(),
		rowCount: integer('row_count').notNull(),
		errorCount: integer('error_count').notNull(),
		warningCount: integer('warning_count').notNull(),
		insertCount: integer('insert_count').notNull(),
		updateCount: integer('update_count').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
	},
	(t) => [
		index('admin_upload_staging_admin_id_idx').on(t.adminTokenHash, t.id),
		index('admin_upload_staging_expires_idx').on(t.expiresAt)
	]
);

// Durable rate-limit buckets. Keys are server-side hashes of the identifying
// value (IP, email hash, or account id) scoped by limiter name.
export const rateLimitBuckets = pgTable(
	'rate_limit_buckets',
	{
		scope: text('scope').notNull(),
		keyHash: text('key_hash').notNull(),
		count: integer('count').notNull().default(0),
		windowStart: timestamp('window_start', { withTimezone: true }).defaultNow().notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [
		primaryKey({ columns: [t.scope, t.keyHash] }),
		index('rate_limit_buckets_expires_idx').on(t.expiresAt)
	]
);

// Single-admin account-wide password backoff. This deliberately is not keyed
// by IP, so rotating addresses cannot bypass growing delays.
export const adminLoginBackoff = pgTable('admin_login_backoff', {
	key: text('key').primaryKey(),
	failedCount: integer('failed_count').notNull().default(0),
	blockedUntil: timestamp('blocked_until', { withTimezone: true }),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

// Admin-authored articles shown on the public /learn tab. Markdown source is
// stored as-is; rendered to HTML server-side on each request so the rendering
// pipeline can evolve without a migration. `slug` is unique and stable —
// editable while the post is a draft, locked once published so live URLs
// stay valid. `publishedAt` is set on first publish and preserved across
// subsequent unpublish/republish cycles so the original publish date sticks.
export const blogStatus = pgEnum('blog_status', ['draft', 'published']);

export const blogPosts = pgTable(
	'blog_posts',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		slug: text('slug').notNull().unique(),
		title: text('title').notNull(),
		excerpt: text('excerpt'),
		coverImageUrl: text('cover_image_url'),
		content: text('content').notNull(),
		status: blogStatus('status').notNull().default('draft'),
		publishedAt: timestamp('published_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [
		index('blog_posts_status_published_idx').on(t.status, t.publishedAt),
		index('blog_posts_updated_idx').on(t.updatedAt)
	]
);

// Admin-managed negotiation-email templates. `body` is plain text with
// {{placeholder}} variables (see src/lib/shared/email-template.ts). On each
// public visit the server picks one random `active` template per aggressiveness
// tier, fills the placeholders with real market data, and offers them as the
// V1/V2/V3 variations. `inactive` templates are never served — admins toggle a
// draft live with the Activate action once it's ready.
//
// `audience` branches templates by the tenant's market position: a template
// tagged `above_median` / `below_median` is only served when the tenant's rent
// is above / below the neighborhood median; `any` templates serve everyone.
//
// `aggressiveness` is the tone scale behind the tenant-facing toggle:
// Version 1 = `baseline`, Version 2 = `more_aggressive`, Version 3 =
// `very_aggressive`.
export const emailTemplateStatus = pgEnum('email_template_status', ['active', 'inactive']);

// Keep these values in sync with AUDIENCE_VALUES in src/lib/shared/email-template.ts.
export const emailTemplateAudience = pgEnum('email_template_audience', [
	'any',
	'above_median',
	'below_median'
]);

// Keep these values in sync with AGGRESSIVENESS_VALUES in src/lib/shared/email-template.ts.
export const emailTemplateAggressiveness = pgEnum('email_template_aggressiveness', [
	'baseline',
	'more_aggressive',
	'very_aggressive'
]);

export const emailTemplates = pgTable(
	'email_templates',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		name: text('name').notNull(),
		body: text('body').notNull(),
		status: emailTemplateStatus('status').notNull().default('inactive'),
		audience: emailTemplateAudience('audience').notNull().default('any'),
		aggressiveness: emailTemplateAggressiveness('aggressiveness')
			.notNull()
			.default('baseline'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [index('email_templates_status_idx').on(t.status)]
);

// Short-lived email-verification codes for the negotiate flow. A user enters
// an email, we mail a 6-digit code, and they must enter it before the
// negotiation emails are generated. The code is stored only as
// sha256(EMAIL_PEPPER + id + code) — never plaintext — and the row id is mixed
// in so two rows with the same code produce different hashes (no cross-row
// replay). Rows are reaped once they age past the rate-limit window — the `ip`
// they hold is PII, so retention is bounded; `email_hash` powers per-email
// send rate limiting.
export const emailVerifications = pgTable(
	'email_verifications',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		emailHash: text('email_hash').notNull(),
		codeHash: text('code_hash').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		attempts: integer('attempts').notNull().default(0),
		consumedAt: timestamp('consumed_at', { withTimezone: true }),
		ip: text('ip'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [
		index('email_verifications_email_hash_idx').on(t.emailHash),
		index('email_verifications_unconsumed_lookup_idx')
			.on(t.emailHash, t.createdAt.desc())
			.where(sql`${t.consumedAt} IS NULL`),
		index('email_verifications_expires_idx').on(t.expiresAt)
	]
);

// Durable record of verified email addresses, kept for future monetization /
// contact. Plaintext `email` plus `email_hash` (same hash fn as
// email_verifications) as the dedup key — one row per address, upserted on
// each successful verification.
export const verifiedEmails = pgTable('verified_emails', {
	id: uuid('id').defaultRandom().primaryKey(),
	email: text('email').notNull(),
	emailHash: text('email_hash').notNull().unique(),
	firstVerifiedAt: timestamp('first_verified_at', { withTimezone: true }).defaultNow().notNull(),
	lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).defaultNow().notNull(),
	verifyCount: integer('verify_count').notNull().default(1)
});

export type AptTypeDb = (typeof aptType.enumValues)[number];
export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
export type SubmissionDedupeKey = typeof submissionDedupeKeys.$inferSelect;
export type NewSubmissionDedupeKey = typeof submissionDedupeKeys.$inferInsert;
export type AdminSession = typeof adminSessions.$inferSelect;
export type AdminUpload = typeof adminUploads.$inferSelect;
export type RateLimitBucket = typeof rateLimitBuckets.$inferSelect;
export type BlogPost = typeof blogPosts.$inferSelect;
export type NewBlogPost = typeof blogPosts.$inferInsert;
export type BlogStatusDb = (typeof blogStatus.enumValues)[number];
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type NewEmailTemplate = typeof emailTemplates.$inferInsert;
export type EmailTemplateStatusDb = (typeof emailTemplateStatus.enumValues)[number];
export type EmailTemplateAudienceDb = (typeof emailTemplateAudience.enumValues)[number];
export type EmailTemplateAggressivenessDb =
	(typeof emailTemplateAggressiveness.enumValues)[number];
export type EmailVerification = typeof emailVerifications.$inferSelect;
export type NewEmailVerification = typeof emailVerifications.$inferInsert;
export type VerifiedEmail = typeof verifiedEmails.$inferSelect;
export type NewVerifiedEmail = typeof verifiedEmails.$inferInsert;
