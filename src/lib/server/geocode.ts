// Server-side address → ZIP geocoding via the US Census geocoder.
//
// The same `onelineaddress` endpoint is proxied for browser autocomplete in
// src/routes/api/address/suggest/+server.ts. Here we call it server-side and
// keep only the ZIP. Per the app's no-PII posture the address is used
// transiently — never logged, never stored.

const CENSUS_ENDPOINT =
	'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

interface CensusRawMatch {
	addressComponents?: { zip?: string };
}
interface CensusRawResponse {
	result?: { addressMatches?: CensusRawMatch[] };
}

/**
 * Resolve a free-text address to a 5-digit ZIP. Returns null on any failure
 * (no match, malformed ZIP, timeout, non-ok response, network error) so
 * callers can fall back gracefully.
 */
export async function geocodeAddressToZip(
	address: string,
	fetchFn: typeof fetch
): Promise<string | null> {
	const q = (address ?? '').trim();
	if (q.length < 3 || q.length > 200) return null;

	const upstream = new URL(CENSUS_ENDPOINT);
	upstream.searchParams.set('address', q);
	upstream.searchParams.set('benchmark', 'Public_AR_Current');
	upstream.searchParams.set('format', 'json');

	try {
		const res = await fetchFn(upstream.toString(), {
			// Census can be slow; 6s is generous but bounded.
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
