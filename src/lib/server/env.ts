import { z } from 'zod';
import { env as privateEnv } from '$env/dynamic/private';
import { building } from '$app/environment';

const schema = z.object({
	DATABASE_URL: z.string().url().optional(),
	// Admin is optional; if unset, /admin returns 503. Hash is argon2id produced by
	// `bun run admin:password`.
	ADMIN_PASSWORD_HASH: z
		.string()
		.min(1)
		.optional()
		.transform((v) => (v && v.length > 0 ? v : undefined)),
	// Cloudflare Turnstile secret key. Optional in dev: when unset OR blank the
	// bot check is disabled (local dev / template mode). REQUIRED in production
	// unless DEMO_MODE is set — the public form would otherwise have no bot
	// protection (see the boot guard in load()). A blank `TURNSTILE_SECRET_KEY=`
	// in .env parses as '' — coerce that to undefined so it's treated as unset.
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
	// Resend API key for sending verification-code emails. Optional in dev: when
	// unset OR blank the code is printed to the server console instead of
	// emailed, so local dev works without a Resend account. REQUIRED in
	// production unless DEMO_MODE is set (see the boot guard in load()). A blank
	// `RESEND_API_KEY=` parses as '' — coerce that to undefined so it reads as unset.
	RESEND_API_KEY: z
		.string()
		.optional()
		.transform((v) => (v && v.length > 0 ? v : undefined)),
	// From address for verification emails, e.g. `Lower Your Rent <verify@…>`.
	// The domain must be verified in Resend or sends fail. Console-log fallback
	// kicks in when either this or RESEND_API_KEY is unset; REQUIRED in
	// production unless DEMO_MODE is set (see the boot guard in load()).
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
	// Optional separate pepper for hashing rate-limit keys. Falls back to
	// EMAIL_PEPPER when unset, but production must have one of them via the
	// existing EMAIL_PEPPER boot guard.
	RATE_LIMIT_PEPPER: z
		.string()
		.optional()
		.transform((v) => (v && v.length > 0 ? v : undefined)),
	// Set to `true` only when the app is served behind Cloudflare. The immediate
	// peer must also match TRUSTED_PROXY_CIDRS before CF-Connecting-IP is trusted.
	TRUST_CF_CONNECTING_IP: z
		.string()
		.optional()
		.transform((v) => v === 'true' || v === '1'),
	// Comma-separated CIDR/IP list for infrastructure allowed to set
	// X-Forwarded-For / X-Real-IP. Leave empty unless Railway or a known proxy
	// terminates traffic before the app.
	TRUSTED_PROXY_CIDRS: z
		.string()
		.optional()
		.transform((v) => (v && v.length > 0 ? v : undefined)),
	// MVP / demo escape hatch. When `true` the negotiate flow runs with NO
	// external dependencies: Resend is skipped, the emailed code is the fixed
	// string "123456", and the Turnstile bot check always passes. Also drops
	// RESEND_API_KEY / EMAIL_FROM / TURNSTILE_SECRET_KEY from the production
	// boot requirements. NEVER leave this on for a real launch — any visitor
	// can verify any email address they don't own.
	DEMO_MODE: z
		.string()
		.optional()
		.transform((v) => v === 'true' || v === '1'),
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
		RATE_LIMIT_PEPPER: privateEnv.RATE_LIMIT_PEPPER,
		TRUST_CF_CONNECTING_IP: privateEnv.TRUST_CF_CONNECTING_IP,
		TRUSTED_PROXY_CIDRS: privateEnv.TRUSTED_PROXY_CIDRS,
		DEMO_MODE: privateEnv.DEMO_MODE,
		NODE_ENV: privateEnv.NODE_ENV
	});
	if (!parsed.success) {
		console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
		throw new Error('Refusing to boot with invalid environment. See errors above.');
	}

	const data = parsed.data;

	// Several vars have dev-only fallbacks that are unsafe in production: a
	// missing DB silently no-ops every query; a missing pepper hashes emails +
	// codes with a publicly-known value; a missing Resend key console-logs the
	// code; a missing Turnstile key leaves the public form with no bot check.
	// Production must set them explicitly — fail loudly at boot, naming every
	// missing var at once, rather than booting degraded.
	//
	// Skipped while `building`: `vite build` (and its postbuild analyse step)
	// runs with NODE_ENV=production but has no runtime secrets, so the guard is
	// a runtime-only check, not a build-time one.
	if (!building && data.NODE_ENV === 'production') {
		// DEMO_MODE makes the negotiate flow run with no external services, so
		// their keys are no longer boot-required (see DEMO_MODE in the schema).
		const required: Record<string, unknown> = {
			DATABASE_URL: data.DATABASE_URL,
			EMAIL_PEPPER: data.EMAIL_PEPPER
		};
		if (!data.DEMO_MODE) {
			required.RESEND_API_KEY = data.RESEND_API_KEY;
			required.EMAIL_FROM = data.EMAIL_FROM;
			required.TURNSTILE_SECRET_KEY = data.TURNSTILE_SECRET_KEY;
		}
		const missing = Object.entries(required)
			.filter(([, v]) => !v)
			.map(([k]) => k);
		if (missing.length > 0) {
			throw new Error(
				`Refusing to boot: ${missing.join(', ')} must be set when NODE_ENV=production.`
			);
		}
	}

	if (!building && data.DEMO_MODE) {
		console.warn(
			'[DEMO_MODE] Negotiate flow has NO external dependencies: Resend skipped, ' +
				'verification code is the fixed string "123456", Turnstile bypassed. ' +
				'Do NOT leave this on for a real launch — anyone can verify any email.'
		);
	}

	return data;
}

export const env = load();
export type Env = typeof env;
