// Shared helpers for seed scripts. Scripts are Bun CLI entrypoints, NOT imported by the app.

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/lib/server/db/schema';

const CACHE_DIR = join(process.cwd(), '.cache', 'seed');

export function log(tag: string, msg: string): void {
	const t = new Date().toISOString().slice(11, 19);
	// eslint-disable-next-line no-console
	console.log(`[${t}] [${tag}] ${msg}`);
}

export function getDb() {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set. Load .env before running seed scripts.');
	const client = postgres(url, { max: 5, idle_timeout: 10 });
	return { db: drizzle(client, { schema }), close: () => client.end() };
}

export async function fetchWithCache(
	url: string,
	cacheName: string,
	{ asText = false, accept }: { asText?: boolean; accept?: string } = {}
): Promise<Buffer | string> {
	const cachePath = join(CACHE_DIR, cacheName);
	if (existsSync(cachePath)) {
		log('cache', `hit: ${cacheName}`);
		const cached = readFileSync(cachePath);
		if (!looksLikeHtml(cached)) {
			return asText ? cached.toString('utf8') : cached;
		}
		log('cache', `discarding HTML response cached as ${cacheName}`);
		unlinkSync(cachePath);
	}
	log('fetch', url);
	mkdirSync(dirname(cachePath), { recursive: true });
	const res = await fetch(url, {
		headers: {
			'User-Agent': 'LowerYourRent seed scripts (contact: admin)',
			Accept: accept ?? '*/*'
		}
	});
	if (!res.ok) {
		throw new Error(`Fetch failed ${res.status} for ${url}`);
	}
	const buf = Buffer.from(await res.arrayBuffer());
	if (looksLikeHtml(buf)) {
		throw new Error(`Fetch returned HTML instead of data for ${url}`);
	}
	writeFileSync(cachePath, buf);
	log('cache', `saved: ${cacheName} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
	return asText ? buf.toString('utf8') : buf;
}

function looksLikeHtml(buf: Buffer): boolean {
	const text = buf.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
	return text.startsWith('<!doctype html') || text.startsWith('<html') || text.startsWith('<');
}

// Insert in chunks to avoid enormous single INSERTs.
export async function chunk<T>(items: T[], size: number, fn: (batch: T[]) => Promise<void>) {
	for (let i = 0; i < items.length; i += size) {
		await fn(items.slice(i, i + size));
	}
}

// Normalize a ZIP to 5 chars.
export function zip5(raw: string | number | undefined): string | null {
	if (raw === undefined || raw === null) return null;
	const s = String(raw).trim();
	if (!/^\d+$/.test(s)) return null;
	return s.padStart(5, '0').slice(0, 5);
}

// Normalize a county FIPS to 5 chars.
export function fips5(raw: string | number | undefined): string | null {
	if (raw === undefined || raw === null) return null;
	const s = String(raw).trim();
	if (!/^\d+$/.test(s)) return null;
	return s.padStart(5, '0').slice(0, 5);
}
