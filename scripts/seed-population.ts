/**
 * Seed `cbsa_population` from the Census Population Estimates Program (PEP).
 *
 * One "alldata" CSV per vintage; each file has POPESTIMATE{YYYY} columns
 * spanning the full intercensal window. We merge two vintages to cover
 * 2010 → latest:
 *
 *   2020-2024 vintage: cbsa-est2024-alldata.csv (years 2020–2024)
 *   2010-2019 vintage: cbsa-est2019-alldata.csv (years 2010–2019)
 *
 * Rows in each file include the CBSA rollup *and* each constituent county;
 * we filter to the rollup row (MDIV empty, STCOU empty).
 *
 * Run: bun run scripts/seed-population.ts
 * Offline: PEP_LOCAL_DIR=/path/to/files bun run scripts/seed-population.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { sql } from 'drizzle-orm';
import { cbsaPopulation } from '../src/lib/server/db/schema';
import { chunk, fetchWithCache, getDb, log } from './_seed-helpers';

interface VintageSource {
	label: string;
	filename: string;
	urlCandidates: string[];
}

const VINTAGES: VintageSource[] = [
	{
		label: '2020-2024',
		filename: 'cbsa-est2024-alldata.csv',
		urlCandidates: [
			'https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/metro/totals/cbsa-est2024-alldata.csv',
			'https://www2.census.gov/programs-surveys/popest/datasets/2020-2023/metro/totals/cbsa-est2023-alldata.csv'
		]
	},
	{
		label: '2010-2019',
		filename: 'cbsa-est2019-alldata.csv',
		urlCandidates: [
			'https://www2.census.gov/programs-surveys/popest/datasets/2010-2019/metro/totals/cbsa-est2019-alldata.csv'
		]
	}
];

interface PopRow {
	year: number;
	cbsaCode: string;
	population: number;
}

async function fetchFirstWorking(v: VintageSource, localDir: string | null): Promise<Buffer | null> {
	if (localDir) {
		const p = join(localDir, v.filename);
		if (existsSync(p)) {
			log('local', `reading ${p}`);
			return readFileSync(p);
		}
	}
	for (const url of v.urlCandidates) {
		try {
			const buf = (await fetchWithCache(url, `pep_${url.split('/').pop()}`)) as Buffer;
			// Detect HTML 404 body that the Census server returns with 2xx sometimes.
			const head = buf.subarray(0, 64).toString('utf8').toLowerCase();
			if (head.startsWith('<!doctype') || head.startsWith('<html')) {
				log('warn', `HTML body at ${url}, trying next`);
				continue;
			}
			return buf;
		} catch (err) {
			log('warn', `fetch failed ${url}: ${(err as Error).message}`);
		}
	}
	return null;
}

function parseVintage(text: string): PopRow[] {
	const records = parse(text, {
		columns: true,
		skip_empty_lines: true,
		trim: true,
		bom: true
	}) as Array<Record<string, string>>;

	const out: PopRow[] = [];
	const yearColPattern = /^POPESTIMATE(\d{4})$/;

	for (const row of records) {
		// CBSA rollup row: MDIV empty, STCOU empty.
		const mdiv = (row.MDIV ?? '').trim();
		const stcou = (row.STCOU ?? '').trim();
		if (mdiv !== '' || stcou !== '') continue;

		const rawCbsa = (row.CBSA ?? '').trim();
		if (!/^\d+$/.test(rawCbsa)) continue;
		const cbsaCode = rawCbsa.padStart(5, '0').slice(0, 5);

		for (const [key, raw] of Object.entries(row)) {
			const m = yearColPattern.exec(key);
			if (!m) continue;
			const year = Number(m[1]);
			const pop = Number(String(raw).replace(/,/g, ''));
			if (!Number.isFinite(year) || year < 2000 || year > 2100) continue;
			if (!Number.isFinite(pop) || pop <= 0) continue;
			out.push({ year, cbsaCode, population: Math.round(pop) });
		}
	}
	return out;
}

async function main() {
	const { db, close } = getDb();
	try {
		const localDir = process.env.PEP_LOCAL_DIR ?? null;

		// Later vintages override earlier vintages for overlapping years.
		// We load 2010-2019 first, then 2020-2024 wins on conflict thanks to
		// the dedupe below and the DB upsert.
		const byKey = new Map<string, PopRow>();
		for (const v of [...VINTAGES].reverse()) {
			// reverse so older vintage processed first
			const buf = await fetchFirstWorking(v, localDir);
			if (!buf) {
				log('warn', `skip vintage ${v.label}: no source available`);
				continue;
			}
			const rows = parseVintage(buf.toString('utf8'));
			log('parse', `${v.label}: ${rows.length} (year × CBSA) rows`);
			for (const r of rows) {
				byKey.set(`${r.year}|${r.cbsaCode}`, r);
			}
		}

		const allRows = Array.from(byKey.values());
		if (allRows.length === 0) {
			log('fail', 'no PEP rows parsed; aborting');
			return;
		}
		log('prep', `ready to upsert ${allRows.length} cbsa_population rows`);

		let upserted = 0;
		await chunk(allRows, 1000, async (batch) => {
			await db
				.insert(cbsaPopulation)
				.values(batch)
				.onConflictDoUpdate({
					target: [cbsaPopulation.year, cbsaPopulation.cbsaCode],
					set: {
						population: sql.raw(`excluded.${cbsaPopulation.population.name}`)
					}
				});
			upserted += batch.length;
		});
		log('done', `upserted ${upserted} cbsa_population rows`);
	} finally {
		await close();
	}
}

await main();
