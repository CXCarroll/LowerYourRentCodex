// Durable rate limiting and trusted client-IP resolution.
//
// Counters live in Postgres so deploys/restarts and horizontal scale do not
// reset limits. Identifiers are stored as scoped hashes rather than raw IPs.

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { sql } from 'drizzle-orm';
import { db } from './db/client';
import { rateLimitBuckets } from './db/schema';
import { env } from './env';

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

interface ClientAddressEvent {
	request: Request;
	getClientAddress?: () => string;
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

function normalizeIp(value: string | null | undefined): string | null {
	if (!value) return null;
	let ip = value.trim();
	if (!ip) return null;

	if (ip.startsWith('[')) {
		const end = ip.indexOf(']');
		if (end > 0) ip = ip.slice(1, end);
	} else {
		const ipv4WithPort = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
		if (ipv4WithPort) ip = ipv4WithPort[1];
	}

	return isIP(ip) ? ip : null;
}

function parseTrustedCidrs(): string[] {
	return (env.TRUSTED_PROXY_CIDRS ?? '')
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
}

function ipv4ToBigInt(ip: string): bigint | null {
	const parts = ip.split('.');
	if (parts.length !== 4) return null;
	let n = 0n;
	for (const part of parts) {
		const value = Number(part);
		if (!Number.isInteger(value) || value < 0 || value > 255) return null;
		n = (n << 8n) + BigInt(value);
	}
	return n;
}

function ipv6ToBigInt(ip: string): bigint | null {
	if (ip.includes('.')) {
		const lastColon = ip.lastIndexOf(':');
		const ipv4 = ipv4ToBigInt(ip.slice(lastColon + 1));
		if (ipv4 === null) return null;
		const high = ((ipv4 >> 16n) & 0xffffn).toString(16);
		const low = (ipv4 & 0xffffn).toString(16);
		ip = `${ip.slice(0, lastColon)}:${high}:${low}`;
	}

	const halves = ip.split('::');
	if (halves.length > 2) return null;
	const left = halves[0] ? halves[0].split(':') : [];
	const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
	const missing = 8 - left.length - right.length;
	if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
	const groups = [...left, ...Array(missing).fill('0'), ...right];
	if (groups.length !== 8) return null;

	let n = 0n;
	for (const group of groups) {
		if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
		n = (n << 16n) + BigInt(Number.parseInt(group, 16));
	}
	return n;
}

function ipToBigInt(ip: string): { version: 4 | 6; value: bigint } | null {
	const version = isIP(ip);
	if (version === 4) {
		const value = ipv4ToBigInt(ip);
		return value === null ? null : { version, value };
	}
	if (version === 6) {
		const value = ipv6ToBigInt(ip);
		return value === null ? null : { version, value };
	}
	return null;
}

function cidrContains(cidr: string, ip: string): boolean {
	const [rawBase, rawPrefix] = cidr.includes('/') ? cidr.split('/') : [cidr, undefined];
	const base = normalizeIp(rawBase);
	if (!base) return false;
	const target = ipToBigInt(ip);
	const source = ipToBigInt(base);
	if (!target || !source || target.version !== source.version) return false;

	const bits = source.version === 4 ? 32 : 128;
	const prefix = rawPrefix === undefined ? bits : Number(rawPrefix);
	if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return false;
	if (prefix === 0) return true;

	const shift = BigInt(bits - prefix);
	return target.value >> shift === source.value >> shift;
}

function isTrustedProxy(ip: string | null): boolean {
	if (!ip) return false;
	return parseTrustedCidrs().some((cidr) => cidrContains(cidr, ip));
}

function firstHeaderIp(value: string | null): string | null {
	if (!value) return null;
	return normalizeIp(value.split(',')[0]);
}

export function getClientIp(event: ClientAddressEvent, fallback = 'unknown'): string {
	const socketIp = normalizeIp(event.getClientAddress?.());

	if (env.TRUST_CF_CONNECTING_IP && isTrustedProxy(socketIp)) {
		const cf = normalizeIp(event.request.headers.get('cf-connecting-ip'));
		if (cf) return cf;
	}

	if (isTrustedProxy(socketIp)) {
		const xff = event.request.headers
			.get('x-forwarded-for')
			?.split(',')
			.map((part) => normalizeIp(part))
			.filter((part): part is string => !!part);
		if (xff && xff.length > 0) {
			for (let i = xff.length - 1; i >= 0; i -= 1) {
				if (!isTrustedProxy(xff[i])) return xff[i];
			}
			return xff[0];
		}

		const real = firstHeaderIp(event.request.headers.get('x-real-ip'));
		if (real) return real;
	}

	return socketIp ?? fallback;
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
