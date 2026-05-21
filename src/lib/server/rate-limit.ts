// Durable rate limiting and trusted client-IP resolution.
//
// Counters live in Postgres so deploys/restarts and horizontal scale do not
// reset limits. Identifiers are stored as scoped hashes rather than raw IPs.

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from './db/client';
import { rateLimitBuckets } from './db/schema';
import { env } from './env';
import { resolveClientIp, type ClientAddressEvent } from './client-ip';

const DEV_RATE_LIMIT_PEPPER = 'dev-rate-limit-pepper-do-not-use-in-production';

export interface RateLimitResult {
	ok: boolean;
	retryAfterSec: number;
	reason?: 'unavailable';
}

export interface RateLimitOptions {
	scope: string;
	key: string;
	limit: number;
	windowMs: number;
}

function pepper(): string {
	return env.RATE_LIMIT_PEPPER ?? env.EMAIL_PEPPER ?? DEV_RATE_LIMIT_PEPPER;
}

function hashKey(scope: string, key: string): string {
	return createHash('sha256')
		.update(pepper())
		.update('\0')
		.update(scope)
		.update('\0')
		.update(key)
		.digest('hex');
}

export function getClientIp(event: ClientAddressEvent, fallback = 'unknown'): string {
	return resolveClientIp(
		event,
		{
			trustCfConnectingIp: env.TRUST_CF_CONNECTING_IP,
			trustedProxyCidrs: env.TRUSTED_PROXY_CIDRS
		},
		fallback
	);
}

export async function consumeRateLimit({
	scope,
	key,
	limit,
	windowMs
}: RateLimitOptions): Promise<RateLimitResult> {
	if (!db) return { ok: false, retryAfterSec: 1, reason: 'unavailable' };

	const safeLimit = Math.max(1, Math.floor(limit));
	const safeWindowMs = Math.max(1, Math.floor(windowMs));
	const keyHash = hashKey(scope, key);

	let rows: Array<{ ok: boolean; retry_after_sec: number }>;
	try {
		rows = (await db.execute(sql`
			with upsert as (
				insert into ${rateLimitBuckets} (
					scope,
					key_hash,
					count,
					window_start,
					expires_at,
					updated_at
				)
				values (
					${scope},
					${keyHash},
					1,
					now(),
					now() + (${safeWindowMs}::double precision * interval '1 millisecond'),
					now()
				)
				on conflict (scope, key_hash) do update set
					count = case
						when ${rateLimitBuckets.expiresAt} <= now() then 1
						else ${rateLimitBuckets.count} + 1
					end,
					window_start = case
						when ${rateLimitBuckets.expiresAt} <= now() then now()
						else ${rateLimitBuckets.windowStart}
					end,
					expires_at = case
						when ${rateLimitBuckets.expiresAt} <= now()
							then now() + (${safeWindowMs}::double precision * interval '1 millisecond')
						else ${rateLimitBuckets.expiresAt}
					end,
					updated_at = now()
				where ${rateLimitBuckets.expiresAt} <= now()
					or ${rateLimitBuckets.count} < ${safeLimit}
				returning expires_at
			),
			current_bucket as (
				select expires_at
				from ${rateLimitBuckets}
				where scope = ${scope} and key_hash = ${keyHash}
			)
			select
				exists(select 1 from upsert) as ok,
				greatest(
					1::double precision,
					ceil(extract(epoch from (
						coalesce(
							(select expires_at from upsert),
							(select expires_at from current_bucket),
							now()
						) - now()
					)))
				)::int as retry_after_sec
		`)) as unknown as Array<{ ok: boolean; retry_after_sec: number }>;
	} catch {
		return { ok: false, retryAfterSec: 1, reason: 'unavailable' };
	}

	const row = rows[0];
	return {
		ok: !!row?.ok,
		retryAfterSec: row?.ok ? 0 : Number(row?.retry_after_sec ?? 1)
	};
}

export async function reapExpiredRateLimitBuckets(): Promise<number> {
	if (!db) return 0;
	const result = await db
		.delete(rateLimitBuckets)
		.where(sql`${rateLimitBuckets.expiresAt} < now()`)
		.returning({ scope: rateLimitBuckets.scope });
	return result.length;
}
