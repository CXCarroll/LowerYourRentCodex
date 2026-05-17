// Same-origin proxy for Mapbox address autocomplete.
//
// Why this exists: the address-autocomplete component calls this route instead
// of api.mapbox.com directly, so the Mapbox token (a private env var) and the
// user's IP both stay server-side — Mapbox never sees the end user. The query
// is not logged or cached (keeps the app's no-PII posture intact).

import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getClientIp } from '$lib/server/rate-limit';
import { suggestMapboxAddresses } from '$lib/server/mapbox';
import { env } from '$lib/server/env';

// Dedicated, looser bucket than the shared OTP limiter: keystroke-triggered
// autocomplete is higher-volume than OTP requests. Refills to full each window.
const CAPACITY = 30;
const WINDOW_MS = 60_000;
const buckets = new Map<string, { tokens: number; refilledAt: number }>();

function consume(ip: string): boolean {
	const now = Date.now();
	const b = buckets.get(ip);
	if (!b) {
		buckets.set(ip, { tokens: CAPACITY - 1, refilledAt: now });
		return true;
	}
	if (now - b.refilledAt >= WINDOW_MS) {
		b.tokens = CAPACITY;
		b.refilledAt = now;
	}
	if (b.tokens <= 0) return false;
	b.tokens -= 1;
	return true;
}

export const GET: RequestHandler = async ({ url, request, fetch }) => {
	const ip = getClientIp(request);
	if (!consume(ip)) {
		return json({ matches: [] }, { status: 429, headers: { 'Cache-Control': 'no-store' } });
	}

	const q = (url.searchParams.get('q') ?? '').trim();
	if (q.length < 3 || q.length > 200) {
		return json({ matches: [] }, { headers: { 'Cache-Control': 'no-store' } });
	}

	const matches = await suggestMapboxAddresses(q, env.MAPBOX_TOKEN, fetch);
	return json({ matches }, { headers: { 'Cache-Control': 'no-store' } });
};
