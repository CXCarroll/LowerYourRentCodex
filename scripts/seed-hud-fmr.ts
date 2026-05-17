/**
 * Seed the `hud_fmr` table from HUD Fair Market Rents XLSX.
 *
 * HUD publishes FY FMRs at:
 *   https://www.huduser.gov/portal/datasets/fmr/fmr{YY}/FY{YY}_FMRs_revised.xlsx
 *   https://www.huduser.gov/portal/datasets/fmr/fmr{YY}/FY{YY}_FMRs.xlsx
 *
 * Schema changes year-to-year. We detect columns by name, fail loudly if they disappear.
 *
 * Run: bun run scripts/seed-hud-fmr.ts
 */

import * as XLSX from 'xlsx';
import { sql } from 'drizzle-orm';
import { hudFmr } from '../src/lib/server/db/schema';
import { chunk, fetchWithCache, fips5, getDb, log } from './_seed-helpers';
import type { AptTypeDb } from '../src/lib/server/db/schema';

const FMR_CANDIDATES: Array<{ url: string; year: number }> = [
	{ url: 'https://www.huduser.gov/portal/datasets/fmr/fmr2024/FY24_FMRs_revised.xlsx', year: 2024 },
	{ url: 'https://www.huduser.gov/portal/datasets/fmr/fmr2024/FY24_FMRs.xlsx', year: 2024 },
	{ url: 'https://www.huduser.gov/portal/datasets/fmr/fmr2023/FY23_FMRs.xlsx', year: 2023 }
];

async function fetchFirstWorking(): Promise<{ buf: Buffer; year: number }> {
	let last: unknown;
	for (const c of FMR_CANDIDATES) {
		try {
			const buf = (await fetchWithCache(c.url, `hud_fmr_${c.year}.xlsx`)) as Buffer;
			return { buf, year: c.year };
		} catch (err) {
			last = err;
			log('warn', `fetch failed for ${c.url}`);
		}
	}
	throw last instanceof Error ? last : new Error(String(last));
}

interface FmrRow {
	year: number;
	countyFips: string;
	aptType: AptTypeDb;
	fmrCents: number;
}

function findKey(keys: string[], ...patterns: RegExp[]): string | undefined {
	for (const p of patterns) {
		const k = keys.find((key) => p.test(key));
		if (k) return k;
	}
	return undefined;
}

async function main() {
	const { db, close } = getDb();
	try {
		const { buf, year } = await fetchFirstWorking();
		const wb = XLSX.read(buf, { type: 'buffer' });
		const sheet = wb.Sheets[wb.SheetNames[0]];
		const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
		if (rows.length === 0) throw new Error('HUD FMR sheet is empty.');

		const keys = Object.keys(rows[0]);
		const stateKey = findKey(keys, /^fips\s*state/i, /^state\s*code/i);
		const countyKey = findKey(keys, /^fips\s*county/i, /^county\s*code/i);
		const combinedFipsKey = keys.find((k) => /^fips[0-9]*$/i.test(k));
		const fmr0Key = findKey(keys, /fmr[_\s]?0|efficiency/i);
		const fmr1Key = findKey(keys, /fmr[_\s]?1|1\s*br/i);
		const fmr2Key = findKey(keys, /fmr[_\s]?2|2\s*br/i);
		const fmr3Key = findKey(keys, /fmr[_\s]?3|3\s*br/i);
		const fmr4Key = findKey(keys, /fmr[_\s]?4|4\s*br/i);

		const hasGeo = combinedFipsKey || (stateKey && countyKey);
		if (!hasGeo || !fmr0Key || !fmr1Key || !fmr2Key || !fmr3Key || !fmr4Key) {
			throw new Error(
				`Unexpected HUD FMR column layout. Got columns: ${keys.join(', ')}. ` +
					'Update scripts/seed-hud-fmr.ts to match.'
			);
		}

		const toInsert: FmrRow[] = [];
		for (const row of rows) {
			let fips: string | null = null;
			if (combinedFipsKey && row[combinedFipsKey] !== null) {
				const raw = String(row[combinedFipsKey]).replace(/\D/g, '');
				fips = fips5(raw.slice(0, 5));
			} else if (stateKey && row[stateKey] !== null) {
				const st = String(row[stateKey]).padStart(2, '0').slice(-2);
				const co = String(row[countyKey] ?? '')
					.replace(/\D/g, '')
					.padStart(3, '0')
					.slice(-3);
				fips = (st + co).slice(0, 5);
			}
			if (!fips || !/^\d{5}$/.test(fips)) continue;

			const mapping: Array<[AptTypeDb, string]> = [
				['studio', fmr0Key],
				['1br', fmr1Key],
				['2br', fmr2Key],
				['3br', fmr3Key],
				['4br_plus', fmr4Key]
			];
			for (const [aptType, key] of mapping) {
				const raw = row[key];
				if (raw === null || raw === undefined) continue;
				const dollars = Number(String(raw).replace(/[^\d.]/g, ''));
				if (!Number.isFinite(dollars) || dollars <= 0) continue;
				toInsert.push({
					year,
					countyFips: fips,
					aptType,
					fmrCents: Math.round(dollars * 100)
				});
			}
		}

		// The HUD file has sub-county (HUD area) rows that share a county FIPS.
		// Keep the highest FMR seen for each (county, apt_type) — that's usually the metro rate.
		const dedup = new Map<string, FmrRow>();
		for (const r of toInsert) {
			const k = `${r.year}|${r.countyFips}|${r.aptType}`;
			const prev = dedup.get(k);
			if (!prev || r.fmrCents > prev.fmrCents) dedup.set(k, r);
		}
		const deduped = Array.from(dedup.values());
		log('prep', `ready to upsert ${deduped.length} hud_fmr rows for FY${year} (from ${toInsert.length} raw)`);

		let upserted = 0;
		await chunk(deduped, 1000, async (batch) => {
			await db
				.insert(hudFmr)
				.values(batch)
				.onConflictDoUpdate({
					target: [hudFmr.year, hudFmr.countyFips, hudFmr.aptType],
					set: { fmrCents: sql.raw(`excluded.${hudFmr.fmrCents.name}`) }
				});
			upserted += batch.length;
		});
		log('done', `upserted ${upserted} hud_fmr rows`);
	} finally {
		await close();
	}
}

await main();
