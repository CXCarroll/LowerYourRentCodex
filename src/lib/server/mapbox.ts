// Mapbox Geocoding API v6 (forward) — server-side address autocomplete + verification.
//
// Both functions run server-side so the Mapbox token and the user's IP never
// leave the server: the browser only ever talks to this app's own
// /api/address/suggest route, never api.mapbox.com directly. The token is
// passed in by the caller (read from the validated env in the route) rather
// than imported here, which keeps this module free of `$env` and unit-testable.
//
// Mapbox usage is transient — no result is logged or persisted. Stored addresses
// still go through the app's own normalizeBuildingAddress() + Census, so this
// stays within Mapbox's temporary-geocoding terms and the no-PII posture.

const FORWARD_ENDPOINT = 'https://api.mapbox.com/search/geocode/v6/forward';

/** UI-ready suggestion: a formatted address plus its ZIP when Mapbox supplies one. */
export interface MapboxAddressMatch {
	display: string;
	zip: string | null;
}

interface MapboxFeature {
	properties?: {
		full_address?: string;
		name?: string;
		place_formatted?: string;
		context?: { postcode?: { name?: string } };
	};
}
interface MapboxResponse {
	features?: MapboxFeature[];
}

/**
 * Map a raw Mapbox v6 forward feature to the app's suggestion shape, or null if
 * the feature carries no usable address string. Exported for unit testing.
 */
export function featureToMatch(f: MapboxFeature): MapboxAddressMatch | null {
	const p = f.properties;
	if (!p) return null;
	const display = (p.full_address ?? [p.name, p.place_formatted].filter(Boolean).join(', ')).trim();
	if (!display) return null;
	const rawZip = p.context?.postcode?.name ?? '';
	return { display, zip: /^\d{5}$/.test(rawZip) ? rawZip : null };
}

/**
 * Address autocomplete suggestions for the dropdown. Restricted to US street
 * addresses. Returns [] when `token` is unset or on any failure, so autocomplete
 * degrades silently to free-typing.
 */
export async function suggestMapboxAddresses(
	query: string,
	token: string | undefined,
	fetchFn: typeof fetch
): Promise<MapboxAddressMatch[]> {
	if (!token) return [];
	const q = (query ?? '').trim();
	if (q.length < 3 || q.length > 200) return [];

	const url = new URL(FORWARD_ENDPOINT);
	url.searchParams.set('q', q);
	url.searchParams.set('access_token', token);
	url.searchParams.set('autocomplete', 'true');
	url.searchParams.set('country', 'us');
	url.searchParams.set('types', 'address');
	url.searchParams.set('limit', '5');

	try {
		const res = await fetchFn(url.toString(), { signal: AbortSignal.timeout(4_000) });
		if (!res.ok) return [];
		const body = (await res.json()) as MapboxResponse;
		const out: MapboxAddressMatch[] = [];
		for (const f of body?.features ?? []) {
			const m = featureToMatch(f);
			if (m) out.push(m);
		}
		return out;
	} catch {
		return [];
	}
}

/**
 * Submit-time existence check for an address. Returns `true` when the submission
 * may proceed, mirroring verifyTurnstileToken's fail-open contract:
 *
 * - `token` unset                → true  (verification disabled; dev/template)
 * - Mapbox error / timeout / !ok → true  (fail-open: an outage must not block)
 * - Mapbox reachable, ≥1 feature → true
 * - Mapbox reachable, 0 features → false (the only rejecting case)
 *
 * A too-short / too-long query also returns false: it cannot be a real address.
 * No `types` filter — street- and place-level matches count as found (lenient
 * matching, per product decision).
 */
export async function verifyAddressExists(
	query: string,
	token: string | undefined,
	fetchFn: typeof fetch
): Promise<boolean> {
	if (!token) return true;
	const q = (query ?? '').trim();
	if (q.length < 3 || q.length > 200) return false;

	const url = new URL(FORWARD_ENDPOINT);
	url.searchParams.set('q', q);
	url.searchParams.set('access_token', token);
	url.searchParams.set('country', 'us');
	url.searchParams.set('limit', '1');

	try {
		const res = await fetchFn(url.toString(), { signal: AbortSignal.timeout(5_000) });
		if (!res.ok) return true; // fail-open
		const body = (await res.json()) as MapboxResponse;
		return (body?.features?.length ?? 0) > 0;
	} catch {
		return true; // fail-open
	}
}
