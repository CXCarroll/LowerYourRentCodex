// Server-side address → ZIP/PUMA geocoding via the US Census geocoder.
//
// The same `onelineaddress` endpoint is proxied for browser autocomplete in
// src/routes/api/address/suggest/+server.ts. Here we call it server-side and
// keep only derived geography IDs. Per the app's no-PII posture the address is
// used transiently — never logged, never stored.

const CENSUS_LOCATIONS_ENDPOINT =
	'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
const CENSUS_GEOGRAPHIES_ENDPOINT =
	'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress';

interface CensusRawMatch {
	addressComponents?: { zip?: string };
	geographies?: unknown;
}
interface CensusRawResponse {
	result?: { addressMatches?: CensusRawMatch[] };
}

export interface GeocodeAddressResult {
	zip: string | null;
	pumaGeoId: string | null;
}

function normalizePumaGeoId(value: unknown, state: unknown): string | null {
	const raw = String(value ?? '').replace(/\D/g, '');
	if (raw.length === 7) return raw;
	if (raw.length !== 5) return null;
	const stateRaw = String(state ?? '').replace(/\D/g, '').padStart(2, '0');
	if (stateRaw.length !== 2) return null;
	return `${stateRaw}${raw}`;
}

function pumaFromObject(obj: Record<string, unknown>): string | null {
	const state = obj.STATE ?? obj.STATEFP ?? obj.STATEFP20 ?? obj.STATEFP10;
	for (const key of ['GEOID', 'GEOID20', 'GEOID10', 'PUMA_GEOID']) {
		const found = normalizePumaGeoId(obj[key], state);
		if (found) return found;
	}
	for (const key of ['PUMA', 'PUMA5CE', 'PUMA5CE20', 'PUMA5CE10']) {
		const found = normalizePumaGeoId(obj[key], state);
		if (found) return found;
	}
	return null;
}

function findPumaGeoId(value: unknown): string | null {
	if (!value || typeof value !== 'object') return null;
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findPumaGeoId(item);
			if (found) return found;
		}
		return null;
	}

	const obj = value as Record<string, unknown>;
	const direct = pumaFromObject(obj);
	if (direct) return direct;

	for (const [key, nested] of Object.entries(obj)) {
		// Prefer walking branches explicitly labeled as PUMA/microdata, but keep
		// the fallback recursive so fixture/vintage shape changes do not break
		// lookups silently.
		if (/puma|microdata/i.test(key)) {
			const found = findPumaGeoId(nested);
			if (found) return found;
		}
	}
	for (const nested of Object.values(obj)) {
		const found = findPumaGeoId(nested);
		if (found) return found;
	}
	return null;
}

/**
 * Resolve a free-text address to derived Census geography IDs. Returns null
 * fields on any failure (no match, malformed data, timeout, non-ok response,
 * network error) so callers can fall back gracefully.
 */
export async function geocodeAddress(
	address: string,
	fetchFn: typeof fetch
): Promise<GeocodeAddressResult> {
	const q = (address ?? '').trim();
	if (q.length < 3 || q.length > 200) return { zip: null, pumaGeoId: null };

	const upstream = new URL(CENSUS_GEOGRAPHIES_ENDPOINT);
	upstream.searchParams.set('address', q);
	upstream.searchParams.set('benchmark', 'Public_AR_Current');
	upstream.searchParams.set('vintage', 'Current_Current');
	upstream.searchParams.set('format', 'json');

	try {
		const res = await fetchFn(upstream.toString(), {
			// Census can be slow; 6s is generous but bounded.
			signal: AbortSignal.timeout(6_000)
		});
		if (!res.ok) return { zip: null, pumaGeoId: null };
		const body = (await res.json()) as CensusRawResponse;
		const matches = body?.result?.addressMatches ?? [];
		for (const m of matches) {
			const zip = m.addressComponents?.zip;
			const normalizedZip = zip && /^\d{5}$/.test(zip) ? zip : null;
			const pumaGeoId = findPumaGeoId(m.geographies);
			if (normalizedZip || pumaGeoId) return { zip: normalizedZip, pumaGeoId };
		}
		return { zip: null, pumaGeoId: null };
	} catch {
		return { zip: null, pumaGeoId: null };
	}
}

/**
 * Backward-compatible ZIP-only helper for older call sites and tests.
 */
export async function geocodeAddressToZip(
	address: string,
	fetchFn: typeof fetch
): Promise<string | null> {
	const result = await geocodeAddress(address, fetchFn);
	if (result.zip) return result.zip;

	const upstream = new URL(CENSUS_LOCATIONS_ENDPOINT);
	upstream.searchParams.set('address', (address ?? '').trim());
	upstream.searchParams.set('benchmark', 'Public_AR_Current');
	upstream.searchParams.set('format', 'json');

	try {
		const res = await fetchFn(upstream.toString(), {
			signal: AbortSignal.timeout(6_000)
		});
		if (!res.ok) return null;
		const body = (await res.json()) as CensusRawResponse;
		const matches = body?.result?.addressMatches ?? [];
		for (const m of matches) {
			const zip = m.addressComponents?.zip;
			if (zip && /^\d{5}$/.test(zip)) return zip;
		}
		return null;
	} catch {
		return null;
	}
}
