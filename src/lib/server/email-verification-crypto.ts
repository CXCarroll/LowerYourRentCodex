// Pure crypto helpers for email verification. Kept free of env / DB imports
// (like proposal-math.ts vs proposal.ts) so the security-critical hashing is
// directly unit-testable. The pepper is always supplied by the caller.

import { randomInt, createHash } from 'node:crypto';

/** Trim + lowercase so the same address always hashes/stores identically. */
export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

/** sha256(pepper + normalized email) — the rate-limit / dedup lookup key. */
export function hashEmail(pepper: string, email: string): string {
	return createHash('sha256')
		.update(pepper + normalizeEmail(email))
		.digest('hex');
}

/**
 * sha256(pepper + rowId + code). Mixing the row id in means two rows holding
 * the same 6-digit code produce different hashes — a code is bound to its row,
 * so a hash can't be replayed against a different row.
 */
export function hashCode(pepper: string, rowId: string, code: string): string {
	return createHash('sha256')
		.update(pepper + rowId + code)
		.digest('hex');
}

/** Cryptographically-random, uniformly-distributed, zero-padded 6-digit code. */
export function generateCode(): string {
	return String(randomInt(0, 1_000_000)).padStart(6, '0');
}
