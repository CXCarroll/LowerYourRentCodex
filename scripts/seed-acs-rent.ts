/**
 * Seed the `acs_rent` table from the Census ACS 5-year estimates.
 *   Table B25064_001E: Median gross rent
 *   Table B25001_001E: Total housing units (used as `sample_size`)
 *   Geography: ZCTA (zip code tabulation area)
 *
 * Docs: https://www.census.gov/data/developers/data-sets/acs-5year.html
 *
 * Run: bun run scripts/seed-acs-rent.ts
 */

import { sql } from 'drizzle-orm';
import { acsRent } from '../src/lib/server/db/schema';
import { chunk, fetchWithCache, getDb, log, zip5 } from './_seed-helpers';

const YEARS_TO_TRY = [2024, 2023, 2022, 2021, 2020];

interface AcsRow {
	year: number;
	geoLevel: string;
	geoId: string;
	medianGrossRentCents: number;
	sampleSize: number | null;
}

async function fetchYear(year: number): Promise<AcsRow[]> {
	const params = new URLSearchParams({
		get: 'B25064_001E,B25001_001E',
		for: 'zip code tabulation area:*'
	});
	if (process.env.CENSUS_API_KEY) params.set('key', process.env.CENSUS_API_KEY);
	const url = `https://api.census.gov/data/${year}/acs/acs5?${params.toString()}`;
	const text = (await fetchWithCache(url, `acs_b25064_${year}.json`, {
		asText: true,
		accept: 'application/json'
	})) as string;
	const arr = JSON.parse(text) as unknown[][];
	if (!Array.isArray(arr) || arr.length < 2) return [];
	const [header, ...rows] = arr;
	const idxRent = (header as string[]).indexOf('B25064_001E');
	const idxUnits = (header as string[]).indexOf('B25001_001E');
	const idxZcta = (header as string[]).findIndex((h) => /zip|zcta/i.test(h));
	const out: AcsRow[] = [];
	for (const row of rows) {
		if (!Array.isArray(row)) continue;
		const rentDollars = Number(row[idxRent]);
		const units = Number(row[idxUnits]);
		const zcta = zip5(String(row[idxZcta]));
		if (!zcta) continue;
		// Census marks missing data as negative numbers (-666666666 etc.)
		if (!Number.isFinite(rentDollars) || rentDollars <= 0) continue;
		out.push({
			year,
			geoLevel: 'zcta',
			geoId: zcta,
			medianGrossRentCents: Math.round(rentDollars * 100),
			sampleSize: Number.isFinite(units) && units > 0 ? Math.round(units) : null
		});
	}
	return out;
}

async function main() {
	const { db, close } = getDb();
	try {
		let rows: AcsRow[] = [];
		for (const y of YEARS_TO_TRY) {
			try {
				log('fetch', `ACS ${y} (B25064 median gross rent, by ZCTA)`);
				rows = await fetchYear(y);
				if (rows.length > 0) {
					log('ok', `ACS ${y}: ${rows.length} rows`);
					break;
				}
			} catch (err) {
				log('warn', `ACS ${y} failed: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
		if (rows.length === 0) {
			throw new Error('All ACS years failed. Check network or Census API availability.');
		}

		let upserted = 0;
		await chunk(rows, 1000, async (batch) => {
			await db
				.insert(acsRent)
				.values(batch)
				.onConflictDoUpdate({
					target: [acsRent.year, acsRent.geoLevel, acsRent.geoId],
					set: {
						medianGrossRentCents: sql.raw(`excluded.${acsRent.medianGrossRentCents.name}`),
						sampleSize: sql.raw(`excluded.${acsRent.sampleSize.name}`)
					}
				});
			upserted += batch.length;
		});
		log('done', `upserted ${upserted} acs_rent rows`);
	} finally {
		await close();
	}
}

await main();
