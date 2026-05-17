/**
 * Seed `building_permits` from the Census Building Permits Survey (BPS).
 *
 * BPS publishes CBSA-level CSV-ish text files, two directories depending on
 * vintage (Census reorganized the data in Jan 2024):
 *
 *   Metro (ending 2023): https://www2.census.gov/econ/bps/Metro%20(ending%202023)/ma{YYYY}a.txt
 *   CBSA  (2024+):        https://www2.census.gov/econ/bps/CBSA%20(beginning%20Jan%202024)/cbsa{YYYY}a.txt
 *
 * Each annual file is ~400 rows (one per CBSA/NECTA metro), with a 2-line header.
 * Column layout (0-indexed, commas separate, no quoting):
 *
 *   0: Survey Date          (e.g. "202399" = 2023 annual total)
 *   1: CSA Code
 *   2: CBSA Code            (5-digit)
 *   3: MONCOV / HHEADER     (coverage flag — ignored)
 *   4: CBSA Name
 *   5/6/7:    1-unit    Bldgs / Units / Value
 *   8/9/10:   2-units   Bldgs / Units / Value
 *   11/12/13: 3-4 units Bldgs / Units / Value
 *   14/15/16: 5+ units  Bldgs / Units / Value
 *   ...then "reported-only" duplicates we ignore.
 *
 * Run: bun run scripts/seed-permits.ts
 * Offline: BPS_LOCAL_DIR=/path/to/files bun run scripts/seed-permits.ts
 *   — reads ma{YYYY}a.txt / cbsa{YYYY}a.txt from a local directory instead
 *     of fetching. Useful if Census is slow.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { buildingPermits } from '../src/lib/server/db/schema';
import { chunk, fetchWithCache, getDb, log } from './_seed-helpers';

const YEAR_RANGE_START = 2015;
const YEAR_RANGE_END = new Date().getUTCFullYear(); // try current year; may 404 if not released

function urlsForYear(year: number): { url: string; cacheName: string; filename: string } {
	if (year >= 2024) {
		const filename = `cbsa${year}a.txt`;
		return {
			url: `https://www2.census.gov/econ/bps/CBSA%20(beginning%20Jan%202024)/${filename}`,
			cacheName: `bps_${filename}`,
			filename
		};
	}
	const filename = `ma${year}a.txt`;
	return {
		url: `https://www2.census.gov/econ/bps/Metro%20(ending%202023)/${filename}`,
		cacheName: `bps_${filename}`,
		filename
	};
}

interface PermitRow {
	year: number;
	month: number; // 0 = annual
	cbsaCode: string;
	units1: number;
	units2: number;
	units34: number;
	units5plus: number;
}

function parseInt0(raw: string | undefined): number {
	if (raw === undefined) return 0;
	const n = parseInt(raw.trim(), 10);
	return Number.isFinite(n) && n >= 0 ? n : 0;
}

function parseAnnualFile(text: string, expectedYear: number): PermitRow[] {
	const out: PermitRow[] = [];
	const lines = text.split(/\r?\n/);
	// Skip the 2-line header + (usually) one blank line.
	for (const line of lines) {
		if (!line.trim()) continue;
		// Skip header rows: first token isn't a pure number yyyyMM / yyyy99.
		const firstComma = line.indexOf(',');
		if (firstComma < 0) continue;
		const surveyDate = line.slice(0, firstComma).trim();
		if (!/^\d{6}$/.test(surveyDate)) continue;

		const fields = line.split(',');
		if (fields.length < 17) continue;

		const rawCbsa = fields[2].trim();
		if (!/^\d+$/.test(rawCbsa)) continue;
		const cbsaCode = rawCbsa.padStart(5, '0').slice(0, 5);

		const year = parseInt(surveyDate.slice(0, 4), 10);
		const monthToken = surveyDate.slice(4);
		// "99" = annual total. Monthly files would use "01".."12".
		const month = monthToken === '99' ? 0 : parseInt(monthToken, 10);
		if (!Number.isFinite(year) || year < 1980 || year > 2100) continue;
		if (year !== expectedYear) continue; // defensive — shouldn't happen

		out.push({
			year,
			month,
			cbsaCode,
			units1: parseInt0(fields[6]),
			units2: parseInt0(fields[9]),
			units34: parseInt0(fields[12]),
			units5plus: parseInt0(fields[15])
		});
	}
	return out;
}

async function loadYear(year: number, localDir: string | null): Promise<Buffer | null> {
	const { url, cacheName, filename } = urlsForYear(year);
	if (localDir) {
		const p = join(localDir, filename);
		if (existsSync(p)) {
			log('local', `reading ${p}`);
			return readFileSync(p);
		}
	}
	try {
		const buf = (await fetchWithCache(url, cacheName)) as Buffer;
		return buf;
	} catch (err) {
		log('warn', `skip ${year}: ${(err as Error).message}`);
		return null;
	}
}

async function main() {
	const { db, close } = getDb();
	try {
		const localDir = process.env.BPS_LOCAL_DIR ?? null;

		const allRows: PermitRow[] = [];
		for (let y = YEAR_RANGE_START; y <= YEAR_RANGE_END; y++) {
			const buf = await loadYear(y, localDir);
			if (!buf) continue;
			// Reject HTML 404 pages (curl saves them to disk via fetch too).
			const head = buf.subarray(0, 64).toString('utf8').toLowerCase();
			if (head.startsWith('<!doctype') || head.startsWith('<html')) {
				log('warn', `skip ${y}: file is HTML (likely 404)`);
				continue;
			}
			const text = buf.toString('utf8');
			const rows = parseAnnualFile(text, y);
			log('parse', `${y}: ${rows.length} CBSA rows`);
			allRows.push(...rows);
		}

		if (allRows.length === 0) {
			log('fail', 'no BPS rows parsed; aborting');
			return;
		}

		log('prep', `ready to upsert ${allRows.length} building_permits rows`);
		let upserted = 0;
		await chunk(allRows, 1000, async (batch) => {
			await db
				.insert(buildingPermits)
				.values(batch)
				.onConflictDoUpdate({
					target: [buildingPermits.year, buildingPermits.month, buildingPermits.cbsaCode],
					set: {
						units1: sql.raw(`excluded.${buildingPermits.units1.name}`),
						units2: sql.raw(`excluded.${buildingPermits.units2.name}`),
						units34: sql.raw(`excluded.${buildingPermits.units34.name}`),
						units5plus: sql.raw(`excluded.${buildingPermits.units5plus.name}`)
					}
				});
			upserted += batch.length;
		});
		log('done', `upserted ${upserted} building_permits rows`);
	} finally {
		await close();
	}
}

await main();
