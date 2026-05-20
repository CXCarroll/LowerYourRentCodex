// Durable limits for /admin/login.

import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { adminLoginBackoff } from '../db/schema';
import { consumeRateLimit, type RateLimitResult } from '../rate-limit';

const IP_LIMIT = 5;
const IP_WINDOW_MS = 10 * 60 * 1000;
const ACCOUNT_KEY = 'admin';
const BASE_BACKOFF_SEC = 30;
const MAX_BACKOFF_SEC = 30 * 60;

export function consumeLoginAttempt(ip: string): Promise<RateLimitResult> {
	return consumeRateLimit({
		scope: 'admin_login_ip',
		key: ip,
		limit: IP_LIMIT,
		windowMs: IP_WINDOW_MS
	});
}

export async function checkAdminLoginBackoff(): Promise<RateLimitResult> {
	if (!db) return { ok: false, retryAfterSec: 1, reason: 'unavailable' };

	let rows: Array<{ blockedUntil: Date | null }>;
	try {
		rows = (await db
			.select({ blockedUntil: adminLoginBackoff.blockedUntil })
			.from(adminLoginBackoff)
			.where(sql`${adminLoginBackoff.key} = ${ACCOUNT_KEY}`)
			.limit(1)) as Array<{ blockedUntil: Date | null }>;
	} catch {
		return { ok: false, retryAfterSec: 1, reason: 'unavailable' };
	}

	const blockedUntil = rows[0]?.blockedUntil;
	if (!blockedUntil) return { ok: true, retryAfterSec: 0 };

	const retryAfterSec = Math.ceil((blockedUntil.getTime() - Date.now()) / 1000);
	return retryAfterSec > 0
		? { ok: false, retryAfterSec }
		: { ok: true, retryAfterSec: 0 };
}

export async function recordFailedAdminLogin(): Promise<void> {
	if (!db) return;

	await db
		.execute(sql`
			insert into ${adminLoginBackoff} (
				key,
				failed_count,
				blocked_until,
				updated_at
			)
			values (
				${ACCOUNT_KEY},
				1,
				now() + (${BASE_BACKOFF_SEC}::double precision * interval '1 second'),
				now()
			)
			on conflict (key) do update set
				failed_count = ${adminLoginBackoff.failedCount} + 1,
				blocked_until = now() + (
					least(
						${MAX_BACKOFF_SEC}::double precision,
						${BASE_BACKOFF_SEC}::double precision *
							power(
								2::double precision,
								least(${adminLoginBackoff.failedCount}, 6)::double precision
							)
					)::double precision * interval '1 second'
				),
				updated_at = now()
		`)
		.catch(() => {});
}

export async function resetAdminLoginBackoff(): Promise<void> {
	if (!db) return;
	await db.delete(adminLoginBackoff).where(sql`${adminLoginBackoff.key} = ${ACCOUNT_KEY}`);
}
