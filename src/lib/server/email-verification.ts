// Email verification: generate, store, and check 6-digit codes for the
// negotiate flow.
//
// Privacy: codes are never stored in plaintext. Each row stores
// sha256(EMAIL_PEPPER + id + code) — the row id is mixed in so identical codes
// in two rows hash differently (binds a code to its row, blocks cross-row
// replay). Emails are hashed the same way for rate-limit lookups; the verified
// address itself is persisted plaintext in `verified_emails` for monetization.

import { randomUUID, timingSafeEqual } from 'node:crypto';
import { and, count, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { db } from './db/client';
import { env } from './env';
import { emailVerifications, verifiedEmails } from './db/schema';
import {
	generateCode,
	hashCode as hashCodeWith,
	hashEmail as hashEmailWith,
	normalizeEmail
} from './email-verification-crypto';

export const CODE_TTL_MS = 10 * 60 * 1000; // codes expire after 10 minutes
export const MAX_ATTEMPTS = 5; // wrong-code guesses per code before lockout
const SEND_LIMIT_PER_EMAIL_HOUR = 5; // codes requestable per email per hour
const SEND_LIMIT_PER_IP_HOUR = 15; // codes requestable per IP per hour
// Rolling window for the send caps above. Rows are retained exactly this long:
// a verification row — and the raw IP it holds — is purged once it ages past
// it, so IP retention is bounded rather than left to chance.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
// Cadence of the background reaper that sweeps aged-out rows.
const REAP_INTERVAL_MS = 15 * 60 * 1000;

// Fallback pepper for local dev only — production MUST set EMAIL_PEPPER.
const DEV_PEPPER = 'dev-email-pepper-do-not-use-in-production';

function pepper(): string {
	return env.EMAIL_PEPPER ?? DEV_PEPPER;
}

function hashEmail(email: string): string {
	return hashEmailWith(pepper(), email);
}

function hashCode(rowId: string, code: string): string {
	return hashCodeWith(pepper(), rowId, code);
}

export type RequestCodeResult =
	| { ok: true; code: string }
	| { ok: false; reason: 'unavailable' | 'rate_limited' };

/**
 * Generate a verification code, persist its hash, and return the plaintext code
 * for the caller to email. Enforces per-email and per-IP hourly send caps.
 */
export async function requestCode(email: string, ip: string): Promise<RequestCodeResult> {
	if (!db) return { ok: false, reason: 'unavailable' };

	const emailHash = hashEmail(email);
	const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);

	const [byEmail] = await db
		.select({ n: count() })
		.from(emailVerifications)
		.where(and(eq(emailVerifications.emailHash, emailHash), gt(emailVerifications.createdAt, since)));
	if (Number(byEmail?.n ?? 0) >= SEND_LIMIT_PER_EMAIL_HOUR) {
		return { ok: false, reason: 'rate_limited' };
	}

	const [byIp] = await db
		.select({ n: count() })
		.from(emailVerifications)
		.where(and(eq(emailVerifications.ip, ip), gt(emailVerifications.createdAt, since)));
	if (Number(byIp?.n ?? 0) >= SEND_LIMIT_PER_IP_HOUR) {
		return { ok: false, reason: 'rate_limited' };
	}

	const id = randomUUID();
	const code = generateCode();
	await db.insert(emailVerifications).values({
		id,
		emailHash,
		codeHash: hashCode(id, code),
		expiresAt: new Date(Date.now() + CODE_TTL_MS),
		ip
	});

	return { ok: true, code };
}

export type VerifyCodeResult =
	| { ok: true }
	| {
			ok: false;
			reason: 'unavailable' | 'not_found' | 'expired' | 'too_many_attempts' | 'bad_code';
	  };

/**
 * Check a code against the newest unconsumed row for the email. On success the
 * row is consumed and the address is upserted into `verified_emails`.
 */
export async function verifyCode(email: string, code: string): Promise<VerifyCodeResult> {
	if (!db) return { ok: false, reason: 'unavailable' };

	const emailHash = hashEmail(email);
	const [row] = await db
		.select()
		.from(emailVerifications)
		.where(and(eq(emailVerifications.emailHash, emailHash), isNull(emailVerifications.consumedAt)))
		.orderBy(desc(emailVerifications.createdAt))
		.limit(1);

	if (!row) return { ok: false, reason: 'not_found' };
	if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };
	if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };

	const expected = Buffer.from(row.codeHash, 'hex');
	const actual = Buffer.from(hashCode(row.id, code), 'hex');
	const matches = expected.length === actual.length && timingSafeEqual(expected, actual);

	if (!matches) {
		await db
			.update(emailVerifications)
			.set({ attempts: row.attempts + 1 })
			.where(eq(emailVerifications.id, row.id));
		return { ok: false, reason: 'bad_code' };
	}

	await db
		.update(emailVerifications)
		.set({ consumedAt: new Date() })
		.where(eq(emailVerifications.id, row.id));

	await db
		.insert(verifiedEmails)
		.values({ email: normalizeEmail(email), emailHash })
		.onConflictDoUpdate({
			target: verifiedEmails.emailHash,
			set: {
				lastVerifiedAt: new Date(),
				verifyCount: sql`${verifiedEmails.verifyCount} + 1`
			}
		});

	return { ok: true };
}

/**
 * Purge email_verifications rows — and the raw IPs they hold — once they age
 * past the rate-limit window. Runs both opportunistically (from
 * /api/verify/send) and on a fixed interval (see startVerificationReaper), so
 * IPs are never retained longer than the rate limiter actually needs them.
 */
export async function reapExpiredVerifications(): Promise<number> {
	if (!db) return 0;
	const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
	const result = await db
		.delete(emailVerifications)
		.where(lt(emailVerifications.createdAt, cutoff))
		.returning({ id: emailVerifications.id });
	return result.length;
}

let reaperStarted = false;

/**
 * Start the background reaper so aged-out verification rows (and their IPs) are
 * purged even when traffic is too low to trigger the opportunistic sweep.
 * Idempotent; the timer is unref'd so it never holds the process open.
 */
export function startVerificationReaper(): void {
	if (reaperStarted) return;
	reaperStarted = true;
	const timer = setInterval(() => {
		reapExpiredVerifications().catch(() => {});
	}, REAP_INTERVAL_MS);
	timer.unref?.();
}
