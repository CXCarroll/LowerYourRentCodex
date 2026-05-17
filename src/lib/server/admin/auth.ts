// Admin authentication + sessions.
// Design:
//   - One admin. Password stored as argon2id hash in env.ADMIN_PASSWORD_HASH.
//   - Session token: 32 random bytes, base64url-encoded. Cookie holds the raw token.
//   - DB stores only sha256(token). A DB leak therefore does not resurrect live sessions.
//   - 8-hour sliding window: if last_seen_at is older than 5 min, bump both last_seen_at
//     and expires_at. Hard cap at 30 days regardless.

import { randomBytes, createHash } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import argon2 from 'argon2';
import type { Cookies } from '@sveltejs/kit';
import { env } from '../env';
import { assertDb } from '../db/client';
import { adminSessions } from '../db/schema';

export const COOKIE_NAME = 'lyr_admin_session';
const SESSION_MAX_MS = 8 * 60 * 60 * 1000; // 8h sliding window
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // bump last_seen_at at most every 5 min
const HARD_CAP_MS = 30 * 24 * 60 * 60 * 1000; // 30d absolute ceiling

// Constant-time dummy so timing is the same whether ADMIN_PASSWORD_HASH is set or not.
// This is a real argon2id encoded hash of a random throwaway string, so verify() takes
// the normal ~150ms instead of failing fast on parse.
const DUMMY_HASH =
	'$argon2id$v=19$m=65536,t=3,p=1$StxhtxHMkIsybhnLYyM4+g$xXx00N/Uoeqt0sbdbMSsizJgF74Dhi/VDutZIvyay6w';

export async function verifyAdminPassword(plain: string): Promise<boolean> {
	const hash = env.ADMIN_PASSWORD_HASH;
	if (!hash) {
		// Still run a verify with the dummy hash so response time matches the happy path.
		await argon2.verify(DUMMY_HASH, plain).catch(() => false);
		return false;
	}
	try {
		return await argon2.verify(hash, plain);
	} catch {
		return false;
	}
}

export function isAdminConfigured(): boolean {
	return !!env.ADMIN_PASSWORD_HASH;
}

function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

function cookieOptions() {
	return {
		httpOnly: true,
		sameSite: 'lax' as const,
		secure: env.NODE_ENV === 'production',
		path: '/',
		maxAge: SESSION_MAX_MS / 1000
	};
}

export async function createAdminSession(
	cookies: Cookies
): Promise<{ expiresAt: Date }> {
	const db = assertDb();
	const token = randomBytes(32).toString('base64url');
	const tokenHash = hashToken(token);
	const expiresAt = new Date(Date.now() + SESSION_MAX_MS);
	await db.insert(adminSessions).values({ tokenHash, expiresAt });
	cookies.set(COOKIE_NAME, token, cookieOptions());
	return { expiresAt };
}

export interface LoadedAdminSession {
	tokenHash: string;
	expiresAt: Date;
	createdAt: Date;
}

export async function loadAdminSession(cookies: Cookies): Promise<LoadedAdminSession | null> {
	const raw = cookies.get(COOKIE_NAME);
	if (!raw) return null;
	const tokenHash = hashToken(raw);
	const db = assertDb();
	const now = new Date();
	const rows = await db
		.select()
		.from(adminSessions)
		.where(eq(adminSessions.tokenHash, tokenHash))
		.limit(1);
	if (rows.length === 0) return null;
	const session = rows[0];
	if (session.expiresAt.getTime() <= now.getTime()) return null;
	// Hard cap: if createdAt + 30d has passed, deny regardless of expires_at.
	if (now.getTime() - session.createdAt.getTime() > HARD_CAP_MS) return null;

	// Sliding refresh.
	if (now.getTime() - session.lastSeenAt.getTime() > REFRESH_INTERVAL_MS) {
		const newExpires = new Date(now.getTime() + SESSION_MAX_MS);
		// Don't let sliding refresh push past the hard cap.
		const cappedExpires = new Date(
			Math.min(newExpires.getTime(), session.createdAt.getTime() + HARD_CAP_MS)
		);
		await db
			.update(adminSessions)
			.set({ lastSeenAt: now, expiresAt: cappedExpires })
			.where(eq(adminSessions.tokenHash, tokenHash));
		return { tokenHash, expiresAt: cappedExpires, createdAt: session.createdAt };
	}
	return { tokenHash, expiresAt: session.expiresAt, createdAt: session.createdAt };
}

export async function revokeAdminSession(cookies: Cookies): Promise<void> {
	const raw = cookies.get(COOKIE_NAME);
	if (raw) {
		const tokenHash = hashToken(raw);
		try {
			const db = assertDb();
			await db.delete(adminSessions).where(eq(adminSessions.tokenHash, tokenHash));
		} catch {
			// If DB is down, still delete the cookie; the row will be swept later.
		}
	}
	cookies.delete(COOKIE_NAME, { path: '/' });
}

// Opportunistic cleanup of expired sessions. Call from a rarely-taken path.
export async function reapExpiredSessions(): Promise<number> {
	const db = assertDb();
	const result = await db
		.delete(adminSessions)
		.where(lt(adminSessions.expiresAt, new Date()))
		.returning({ tokenHash: adminSessions.tokenHash });
	return result.length;
}

// Exported for tests only — not part of the public surface.
export const _internal = { hashToken, DUMMY_HASH };
