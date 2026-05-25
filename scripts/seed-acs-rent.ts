/**
 * Seed the `acs_rent` table from the Census ACS 5-year estimates.
 *   Table B25064_001E: Median gross rent
 *   Table B25001_001E: Total housing units (used as `sample_size`)
 *   Geography: ZCTA (zip code tabulation area)
 *
 * Docs: https://www.census.gov/data/developers/data-sets/acs-5year.html
 *
 * Run:
 *   bun run seed:acs
 *   CENSUS_API_KEY=... bun run seed:acs
 *   ACS_REQUIRE_API_KEY=true CENSUS_API_KEY=... bun run seed:acs
 *   ACS_YEAR=2024 CENSUS_API_KEY=... bun run seed:acs
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { acsRent } from '../src/lib/server/db/schema';
import { chunk, fetchWithCache, getDb, log } from './_seed-helpers';
import {
	buildAcsUrl,
	fetchAndParseAcsYear,
	getAcsSeedConfig,
	redactedUrl,
	type AcsRow
} from './seed-acs-rent-lib';

async function fetchYear(year: number, apiKey: string | null): Promise<{
	rows: AcsRow[];
	skippedInvalidRentRows: number;
	skippedInvalidGeoRows: number;
	url: string;
}> {
	const url = buildAcsUrl(year, apiKey);
	log('fetch', redactedUrl(url));
	return fetchAndParseAcsYear(year, apiKey, async (fetchUrl, logUrl, validate) => {
		return (await fetchWithCache(fetchUrl, `acs_b25064_${year}.json`, {
			asText: true,
			accept: 'application/json',
			logUrl,
			validate: (body) => validate(body)
		})) as string;
	});
}

async function diffAgainstDb(rows: AcsRow[]): Promise<{
	insertCount: number;
	updateCount: number;
}> {
	if (rows.length === 0) return { insertCount: 0, updateCount: 0 };
	const { db, close } = getDb();
	try {
		const byYearLevel = new Map<string, Set<string>>();
		for (const r of rows) {
			const k = `${r.year}|${r.geoLevel}`;
			let set = byYearLevel.get(k);
			if (!set) {
				set = new Set<string>();
				byYearLevel.set(k, set);
			}
			set.add(r.geoId);
		}

		let updates = 0;
		for (const [k, geoIdsSet] of byYearLevel) {
			const [yearStr, geoLevel] = k.split('|');
			const year = Number(yearStr);
			const geoIds = Array.from(geoIdsSet);
			for (let i = 0; i < geoIds.length; i += 5000) {
				const batch = geoIds.slice(i, i + 5000);
				const existing = await db
					.select({ geoId: acsRent.geoId })
					.from(acsRent)
					.where(
						and(
							eq(acsRent.year, year),
							eq(acsRent.geoLevel, geoLevel),
							inArray(acsRent.geoId, batch)
						)
					);
				updates += existing.length;
			}
		}

		return { insertCount: rows.length - updates, updateCount: updates };
	} finally {
		await close();
	}
}

async function upsertRows(rows: AcsRow[]): Promise<number> {
	const { db, close } = getDb();
	try {
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
		return upserted;
	} finally {
		await close();
	}
}

async function main() {
	const config = getAcsSeedConfig(process.env);
	log(
		'seed',
		`ACS API seed starting (${config.apiKey ? 'API key configured' : 'no API key'}, years: ${config.yearsToTry.join(', ')})`
	);

	let selected:
		| {
				year: number;
				rows: AcsRow[];
				skippedInvalidRentRows: number;
				skippedInvalidGeoRows: number;
				url: string;
		  }
		| null = null;
	for (const y of config.yearsToTry) {
		try {
			log('fetch', `ACS ${y} (B25064 median gross rent, by ZCTA)`);
			const result = await fetchYear(y, config.apiKey);
			if (result.rows.length > 0) {
				selected = { year: y, ...result };
				break;
			}
			log('warn', `ACS ${y} returned no valid rows`);
		} catch (err) {
			log('warn', `ACS ${y} failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	if (!selected) {
		throw new Error('All ACS years failed. Check network, CENSUS_API_KEY, or Census API availability.');
	}

	const { insertCount, updateCount } = await diffAgainstDb(selected.rows);
	log(
		'ok',
		[
			`ACS ${selected.year}: ${selected.rows.length} valid rows`,
			`${insertCount} inserts`,
			`${updateCount} updates`,
			`${selected.skippedInvalidRentRows} skipped invalid rent rows`,
			`${selected.skippedInvalidGeoRows} skipped invalid geography rows`
		].join(', ')
	);
	log('source', redactedUrl(selected.url));

	const upserted = await upsertRows(selected.rows);
	log('done', `upserted ${upserted} acs_rent rows`);
}

await main();
