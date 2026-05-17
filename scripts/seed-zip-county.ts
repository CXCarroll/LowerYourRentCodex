/**
 * Seed the `zip_county` table from public Census files.
 *
 *   ZCTA → county FIPS: Census 2020 national relationship file (pipe-delimited).
 *     https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt
 *
 *   county FIPS → CBSA: OMB/Census delineation file (XLSX).
 *     https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2023/delineation-files/list1_2023.xlsx
 *
 * Run: bun run scripts/seed-zip-county.ts
 */

import * as XLSX from 'xlsx';
import { sql } from 'drizzle-orm';
import { zipCounty } from '../src/lib/server/db/schema';
import { chunk, fetchWithCache, fips5, getDb, log, zip5 } from './_seed-helpers';

const ZCTA_COUNTY_URL =
	'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt';

// CBSA delineation list URLs change year-to-year. Try a few.
const CBSA_CANDIDATES = [
	'https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2023/delineation-files/list1_2023.xlsx',
	'https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2020/delineation-files/list1_2020.xls'
];

async function fetchFirstWorking(urls: string[], cacheName: string): Promise<Buffer> {
	let last: unknown;
	for (const url of urls) {
		try {
			const out = await fetchWithCache(url, cacheName);
			return out as Buffer;
		} catch (err) {
			last = err;
			log('warn', `fetch failed for ${url}`);
		}
	}
	throw last instanceof Error ? last : new Error(String(last));
}

async function loadZctaToCounty(): Promise<Map<string, string>> {
	const text = (await fetchWithCache(ZCTA_COUNTY_URL, 'zcta_county.txt', {
		asText: true
	})) as string;
	const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
	if (lines.length < 2) throw new Error('ZCTA-county file is empty');

	const header = lines[0].split('|');
	const zctaIdx = header.findIndex((h) => /GEOID_ZCTA5/i.test(h));
	const countyIdx = header.findIndex((h) => /^GEOID_COUNTY_\d+$/i.test(h));
	if (zctaIdx < 0 || countyIdx < 0) {
		throw new Error(
			`Unexpected ZCTA-county header. Got: ${header.join(' | ')}. Expected GEOID_ZCTA5_* and GEOID_COUNTY_*.`
		);
	}

	const map = new Map<string, string>();
	for (let i = 1; i < lines.length; i++) {
		const cols = lines[i].split('|');
		const zcta = zip5(cols[zctaIdx]);
		const county = fips5(cols[countyIdx]);
		if (!zcta || !county) continue;
		// A ZCTA can span counties; keep the first row (largest population share per Census ordering).
		if (!map.has(zcta)) map.set(zcta, county);
	}
	log('zcta', `loaded ${map.size} ZCTA → county rows`);
	return map;
}

async function loadCountyToCbsa(): Promise<Map<string, string>> {
	const buf = await fetchFirstWorking(CBSA_CANDIDATES, 'cbsa_delineation.xlsx');
	const wb = XLSX.read(buf, { type: 'buffer' });
	const sheetName = wb.SheetNames[0];
	const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], {
		defval: null,
		range: 2 // OMB files have 2 title rows before the header
	});

	// Header names can vary slightly ("FIPS State Code", "FIPS County Code", "CBSA Code")
	const map = new Map<string, string>();
	for (const row of rows) {
		const keys = Object.keys(row);
		const stateKey = keys.find((k) => /fips\s*state\s*code/i.test(k));
		const countyKey = keys.find((k) => /fips\s*county\s*code/i.test(k));
		const cbsaKey = keys.find((k) => /cbsa\s*code/i.test(k));
		if (!stateKey || !countyKey || !cbsaKey) continue;
		const state = fips5(String(row[stateKey]).slice(0, 2));
		const county = String(row[countyKey] ?? '').padStart(3, '0');
		const cbsa = String(row[cbsaKey] ?? '').trim();
		if (!state || !county || !cbsa) continue;
		const fips = (state.slice(-2) + county).padStart(5, '0').slice(0, 5);
		map.set(fips, cbsa.padStart(5, '0').slice(0, 5));
	}
	log('cbsa', `loaded ${map.size} county → CBSA rows`);
	return map;
}

async function main() {
	const { db, close } = getDb();
	try {
		const [zctaToCounty, countyToCbsa] = await Promise.all([
			loadZctaToCounty(),
			loadCountyToCbsa()
		]);

		const rows = Array.from(zctaToCounty.entries()).map(([zip, countyFips]) => ({
			zip,
			countyFips,
			cbsaCode: countyToCbsa.get(countyFips) ?? null
		}));
		log('prep', `ready to upsert ${rows.length} zip_county rows`);

		let upserted = 0;
		await chunk(rows, 1000, async (batch) => {
			await db
				.insert(zipCounty)
				.values(batch)
				.onConflictDoUpdate({
					target: zipCounty.zip,
					set: {
						countyFips: sql.raw(`excluded.${zipCounty.countyFips.name}`),
						cbsaCode: sql.raw(`excluded.${zipCounty.cbsaCode.name}`)
					}
				});
			upserted += batch.length;
			if (upserted % 10000 === 0) log('upsert', `${upserted} / ${rows.length}`);
		});
		log('done', `upserted ${upserted} rows into zip_county`);
	} finally {
		await close();
	}
}

await main();
