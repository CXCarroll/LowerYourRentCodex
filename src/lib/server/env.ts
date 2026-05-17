import { z } from 'zod';
import { env as privateEnv } from '$env/dynamic/private';

const schema = z.object({
	DATABASE_URL: z.string().url().optional(),
	// Admin is optional; if unset, /admin returns 503. Hash is argon2id produced by
	// `bun run admin:password`.
	ADMIN_PASSWORD_HASH: z
		.string()
		.min(1)
		.optional()
		.transform((v) => (v && v.length > 0 ? v : undefined)),
	// Cloudflare Turnstile secret key. Optional: when unset OR blank the bot
	// check is disabled (local dev / template mode). Set it in production to
	// enforce. A blank `TURNSTILE_SECRET_KEY=` in .env parses as '' — coerce
	// that to undefined so it's treated as unset.
	TURNSTILE_SECRET_KEY: z
		.string()
		.optional()
		.transform((v) => (v && v.length > 0 ? v : undefined)),
	// Mapbox access token. Used only server-side — in the address-autocomplete
	// proxy and the submit-time address check. Optional: when unset OR blank,
	// autocomplete falls back to free-typing and verification is skipped. A blank
	// `MAPBOX_TOKEN=` parses as '' — coerce that to undefined so it reads as unset.
	MAPBOX_TOKEN: z
		.string()
		.optional()
		.transform((v) => (v && v.length > 0 ? v : undefined)),
	// Resend API key for sending verification-code emails. Optional: when unset
	// OR blank the code is printed to the server console instead of emailed, so
	// local dev works without a Resend account. Set it in production. A blank
	// `RESEND_API_KEY=` parses as '' — coerce that to undefined so it reads as unset.
	RESEND_API_KEY: z
		.string()
		.optional()
		.transform((v) => (v && v.length > 0 ? v : undefined)),
	// From address for verification emails, e.g. `Lower Your Rent <verify@…>`.
	// The domain must be verified in Resend or sends fail. Console-log fallback
	// kicks in when either this or RESEND_API_KEY is unset.
	EMAIL_FROM: z
		.string()
		.optional()
		.transform((v) => (v && v.length > 0 ? v : undefined)),
	// Secret pepper mixed into the sha256 of emails + codes. Optional in dev
	// (a fixed fallback is used); MUST be set to a strong random value in
	// production — it's effectively permanent (rotating it breaks the
	// verified_emails dedup key).
	EMAIL_PEPPER: z
		.string()
		.optional()
		.transform((v) => (v && v.length > 0 ? v : undefined)),
	NODE_ENV: z.enum(['development', 'production', 'test']).default('development')
});

function load() {
	const parsed = schema.safeParse({
		DATABASE_URL: privateEnv.DATABASE_URL,
		ADMIN_PASSWORD_HASH: privateEnv.ADMIN_PASSWORD_HASH,
		TURNSTILE_SECRET_KEY: privateEnv.TURNSTILE_SECRET_KEY,
		MAPBOX_TOKEN: privateEnv.MAPBOX_TOKEN,
		RESEND_API_KEY: privateEnv.RESEND_API_KEY,
		EMAIL_FROM: privateEnv.EMAIL_FROM,
		EMAIL_PEPPER: privateEnv.EMAIL_PEPPER,
		NODE_ENV: privateEnv.NODE_ENV
	});
	if (!parsed.success) {
		console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
		throw new Error('Refusing to boot with invalid environment. See errors above.');
	}

	return parsed.data;
}

export const env = load();
export type Env = typeof env;
