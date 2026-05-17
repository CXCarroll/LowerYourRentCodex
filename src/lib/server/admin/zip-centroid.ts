// Resolve a ZIP → lat/lng via the US Census Geocoder, caching hits in the
// `zip_centroids` table. Census's `locations/onelineaddress` endpoint does
// not accept a bare ZIP, so we query with " ZIP" padded with state lookup
// — but a simpler approach that works reliably is to use the
// `geographies/coordinates` or the public Nominatim endpoint. Experiments
// show the US Census "addressbatch"-style lookups reject bare ZIPs.
//
// Approach: hit Nominatim (public, no key, courteous use) server-side with
// `postalcode=<zip>&country=us`. If that fails, return null. Results get
// written to `zip_centroids` so subsequent lookups are O(1) DB.

import { eq, sql } from 'drizzle-orm';
import { assertDb } from '../db/client';
import { zipCentroids } from '../db/schema';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'LowerYourRent-admin/0.1 (admin ZIP explorer)';

export interface Centroid {
	lat: number;
	lng: number;
}

/** Look up a ZIP centroid (cached) or return null on upstream failure. */
export async function resolveZipCentroid(zip: string): Promise<Centroid | null> {
	if (!/^\d{5}$/.test(zip)) return null;

	const db = assertDb();
	const cached = await db
		.select({ lat: zipCentroids.lat, lng: zipCentroids.lng })
		.from(zipCentroids)
		.where(eq(zipCentroids.zip, zip))
		.limit(1);
	if (cached.length > 0) {
		return { lat: Number(cached[0].lat), lng: Number(cached[0].lng) };
	}

	const url = new URL(NOMINATIM);
	url.searchParams.set('postalcode', zip);
	url.searchParams.set('country', 'us');
	url.searchParams.set('format', 'json');
	url.searchParams.set('limit', '1');

	try {
		const res = await fetch(url.toString(), {
			headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
			signal: AbortSignal.timeout(6_000)
		});
		if (!res.ok) return null;
		const body = (await res.json()) as Array<{ lat?: string; lon?: string }>;
		const hit = body[0];
		if (!hit?.lat || !hit?.lon) return null;
		const lat = Number(hit.lat);
		const lng = Number(hit.lon);
		if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

		// Cache. Swallow conflicts (concurrent writes).
		try {
			await db
				.insert(zipCentroids)
				.values({ zip, lat: String(lat), lng: String(lng) })
				.onConflictDoUpdate({
					target: zipCentroids.zip,
					set: { lat: String(lat), lng: String(lng), resolvedAt: sql`now()` }
				});
		} catch {
			/* non-fatal */
		}
		return { lat, lng };
	} catch {
		return null;
	}
}
