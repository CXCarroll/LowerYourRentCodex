// ZIP -> (county_fips, cbsa_code) lookup. Reads from the `zip_county` table
// which is populated by `scripts/seed-zip-county.ts`.

import { eq } from 'drizzle-orm';
import { assertDb } from './db/client';
import { zipCounty } from './db/schema';

export interface ZipLookup {
	zip: string;
	countyFips: string | null;
	cbsaCode: string | null;
}

export async function lookupZip(zip: string): Promise<ZipLookup | null> {
	const db = assertDb();
	const rows = await db.select().from(zipCounty).where(eq(zipCounty.zip, zip)).limit(1);
	if (rows.length === 0) return null;
	return {
		zip: rows[0].zip,
		countyFips: rows[0].countyFips,
		cbsaCode: rows[0].cbsaCode
	};
}
