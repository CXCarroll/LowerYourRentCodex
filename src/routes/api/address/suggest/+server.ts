// Same-origin proxy for Mapbox address autocomplete.
//
// Why this exists: the address-autocomplete component calls this route instead
// of api.mapbox.com directly, so the Mapbox token (a private env var) and the
// user's IP both stay server-side — Mapbox never sees the end user. The query
// is not logged or cached (keeps the app's no-PII posture intact).

import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { consumeRateLimit, getClientIp } from '$lib/server/rate-limit';
import { suggestMapboxAddresses } from '$lib/server/mapbox';
import { env } from '$lib/server/env';

// Dedicated, looser bucket than the shared OTP limiter: keystroke-triggered
// autocomplete is higher-volume than OTP requests. Refills to full each window.
const CAPACITY = 30;
const WINDOW_MS = 60_000;

export const GET: RequestHandler = async (event) => {
	const { url, fetch } = event;
	const ip = getClientIp(event);
	const gate = await consumeRateLimit({
		scope: 'mapbox_suggest_ip',
		key: ip,
		limit: CAPACITY,
		windowMs: WINDOW_MS
	});
	if (!gate.ok) {
		return json(
			{ matches: [] },
			{
				status: gate.reason === 'unavailable' ? 503 : 429,
				headers: {
					'Cache-Control': 'no-store',
					...(gate.reason === 'unavailable' ? {} : { 'Retry-After': String(gate.retryAfterSec) })
				}
			}
		);
	}

	const q = (url.searchParams.get('q') ?? '').trim();
	if (q.length < 3 || q.length > 200) {
		return json({ matches: [] }, { headers: { 'Cache-Control': 'no-store' } });
	}

	const matches = await suggestMapboxAddresses(q, env.MAPBOX_TOKEN, fetch);
	return json({ matches }, { headers: { 'Cache-Control': 'no-store' } });
};
