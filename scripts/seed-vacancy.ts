/**
 * Seed `vacancy_rates` from the Census Housing Vacancy Survey (HVS) Table 4,
 * "Rental Vacancy Rates for the 75 Largest Metropolitan Statistical Areas".
 *
 * HVS only lists MSA *names* (no CBSA codes), so we fuzzy-match against the
 * OMB CBSA delineation file's "CBSA Title" column to recover codes.
 *
 * Source:
 *   https://www.census.gov/housing/hvs/data/rates/tab4_msa_15_25_rvr.xlsx
 *
 * Run: bun run scripts/seed-vacancy.ts
 */

import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { sql } from 'drizzle-orm';
import { vacancyRates } from '../src/lib/server/db/schema';
import { chunk, fetchWithCache, getDb, log } from './_seed-helpers';

const HVS_CANDIDATES = [
	'https://www.census.gov/housing/hvs/data/rates/tab4_msa_15_25_rvr.xlsx',
	'https://www.census.gov/housing/hvs/data/rates/tab4_msa_15_24_rvr.xlsx',
	'https://www.census.gov/housing/hvs/data/rates/tab4_msa_15_19_rvr.xlsx'
];

const CBSA_DELINEATION_URLS = [
	'https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2023/delineation-files/list1_2023.xlsx',
	'https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2020/delineation-files/list1_2020.xls'
];

// Manual overrides for MSAs whose HVS name no longer exactly matches any current CBSA title
// (usually because the CBSA was redrawn/renamed in 2018 or 2023).
// Keys are HVS names as they appear in the file (normalized); values are CBSA codes.
const MANUAL_NAME_TO_CBSA: Record<string, string> = {
	// 2018/2023 rename: San Francisco-Oakland-Hayward/Fremont -> Oakland-Berkeley
	'san francisco-oakland-hayward, ca': '41860',
	'san francisco-oakland-fremont, ca': '41860',
	'san francisco-oakland-berkeley, ca': '41860',
	// Buffalo name change 2023
	'buffalo-cheektowaga-niagara falls, ny': '15380',
	'buffalo-cheektowaga, ny': '15380',
	// Riverside-San Bernardino renamed
	'riverside-san bernardino-ontario, ca': '40140',
	// New Orleans boundary shifts
	'new orleans-metairie, la': '35380',
	'new orleans-metairie-kenner, la': '35380',
	// Boston
	'boston-cambridge-newton, ma-nh': '14460',
	// DC
	'washington-arlington-alexandria, dc-va-md-wv': '47900',
	// NYC
	'new york-newark-jersey city, ny-nj-pa': '35620',
	'new york-newark-jersey city, ny-nj': '35620',
	// LA
	'los angeles-long beach-anaheim, ca': '31080',
	// Chicago
	'chicago-naperville-elgin, il-in-wi': '16980',
	'chicago-naperville-elgin, il-in': '16980',
	// Dallas
	'dallas-fort worth-arlington, tx': '19100',
	// Houston
	'houston-pasadena-the woodlands, tx': '26420',
	'houston-the woodlands-sugar land, tx': '26420',
	// Philadelphia
	'philadelphia-camden-wilmington, pa-nj-de-md': '37980',
	// Miami
	'miami-fort lauderdale-pompano beach, fl': '33100',
	'miami-fort lauderdale-west palm beach, fl': '33100',
	// Atlanta
	'atlanta-sandy springs-alpharetta, ga': '12060',
	'atlanta-sandy springs-roswell, ga': '12060',
	// HVS lists tri-state CBSAs with a different state order than the delineation file
	'memphis, tn-ar-ms': '32820'
};

interface VacancyRow {
	year: number;
	quarter: number;
	cbsaCode: string;
	rentalVacancyPct: string;
}

function normalizeName(raw: string): string {
	return (
		raw
			.toLowerCase()
			.replace(/[\u2026\u2027]/g, '') // strip unicode ellipsis / hyphenation point
			.replace(/\.+/g, '') // strip repeated dots used as visual fill
			.replace(/[\u2013\u2014]/g, '-') // en/em dash → hyphen
			// strip trailing footnote digits after a state abbreviation, e.g. "ga1" -> "ga"
			.replace(/\b([a-z]{2})\d+\b/g, '$1')
			.replace(/\s+/g, ' ')
			.trim()
	);
}

// Extract "[first-city-group, STATES]" signature for loose matching.
// e.g. "austin-round rock, tx" -> { head: "austin", states: "tx" }
function signatureOf(normalized: string): { head: string; tail: string; states: string } | null {
	const parts = normalized.split(',');
	if (parts.length < 2) return null;
	const left = parts[0].trim();
	const states = parts[parts.length - 1].trim();
	const cities = left.split('-').map((s) => s.trim()).filter(Boolean);
	if (cities.length === 0) return null;
	return { head: cities[0], tail: cities[cities.length - 1], states };
}

// Parse a quarter label like "First Quarter 2019" or "***Fourth Quarter 2023 (r)"
function parsePeriodLabel(label: string): { year: number; quarter: number } | null {
	const ordinals: Record<string, number> = {
		first: 1,
		second: 2,
		third: 3,
		fourth: 4
	};
	const clean = label.replace(/\s+/g, ' ').trim();
	const m = clean.match(/(first|second|third|fourth)\s+quarter\s+(\d{4})/i);
	if (m) return { quarter: ordinals[m[1].toLowerCase()], year: parseInt(m[2], 10) };
	const m2 = clean.match(/(\d{4})\s*Q\s*([1-4])/i);
	if (m2) return { year: parseInt(m2[1], 10), quarter: parseInt(m2[2], 10) };
	return null;
}

async function fetchFirstWorking<T>(
	candidates: string[],
	cacheName: (url: string) => string
): Promise<Buffer> {
	let last: unknown;
	for (const url of candidates) {
		try {
			return (await fetchWithCache(url, cacheName(url))) as Buffer;
		} catch (err) {
			last = err;
			log('warn', `fetch failed for ${url}`);
		}
	}
	throw last instanceof Error ? last : new Error(String(last));
}

interface CbsaIndex {
	exact: Map<string, string>;
	// Secondary index keyed by (head city, state group) for loose matching.
	loose: Map<string, string[]>; // "austin|tx" -> [cbsaCode, ...]
	// Keep original titles for debug logging.
	titles: Map<string, string>; // cbsaCode -> "Austin-Round Rock-San Marcos, TX"
}

async function loadCbsaIndex(): Promise<CbsaIndex> {
	const buf = await fetchFirstWorking(
		CBSA_DELINEATION_URLS,
		(u) => `cbsa_delineation_${u.split('/').slice(-2, -1)[0]}.xlsx`
	);
	const wb = XLSX.read(buf, { type: 'buffer' });
	const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], {
		defval: null,
		range: 2
	});
	const exact = new Map<string, string>();
	const loose = new Map<string, string[]>();
	const titles = new Map<string, string>();
	for (const row of rows) {
		const keys = Object.keys(row);
		const titleKey = keys.find((k) => /cbsa\s*title/i.test(k));
		const codeKey = keys.find((k) => /cbsa\s*code/i.test(k));
		if (!titleKey || !codeKey) continue;
		const title = row[titleKey];
		const code = row[codeKey];
		if (!title || !code) continue;
		const titleStr = String(title);
		const codeStr = String(code).padStart(5, '0').slice(0, 5);
		const norm = normalizeName(titleStr);
		exact.set(norm, codeStr);
		titles.set(codeStr, titleStr);
		const sig = signatureOf(norm);
		if (sig) {
			for (const city of [sig.head, sig.tail]) {
				const key = `${city}|${sig.states}`;
				const list = loose.get(key) ?? [];
				if (!list.includes(codeStr)) list.push(codeStr);
				loose.set(key, list);
			}
		}
	}
	log('cbsa', `loaded ${exact.size} CBSA titles`);
	return { exact, loose, titles };
}

function looseMatch(normalized: string, idx: CbsaIndex): string | null {
	const sig = signatureOf(normalized);
	if (!sig) return null;
	// Try head city + state group first (stronger signal).
	const hits = idx.loose.get(`${sig.head}|${sig.states}`);
	if (hits && hits.length === 1) return hits[0];
	// Then tail city + state group.
	const hits2 = idx.loose.get(`${sig.tail}|${sig.states}`);
	if (hits2 && hits2.length === 1) return hits2[0];
	// Multi-hit disambiguation: prefer whichever CBSA title shares the most tokens.
	const candidates = (hits && hits.length > 1 ? hits : hits2) ?? [];
	if (candidates.length > 1) {
		const hvsTokens = new Set(normalized.split(/[-, ]+/).filter(Boolean));
		let best: string | null = null;
		let bestScore = -1;
		for (const code of candidates) {
			const title = idx.titles.get(code) ?? '';
			const cbsaTokens = new Set(normalizeName(title).split(/[-, ]+/).filter(Boolean));
			let score = 0;
			for (const t of hvsTokens) if (cbsaTokens.has(t)) score += 1;
			if (score > bestScore) {
				bestScore = score;
				best = code;
			}
		}
		return best;
	}
	return null;
}

async function main() {
	const { db, close } = getDb();
	try {
		const localPath = process.env.HVS_LOCAL_FILE;
		const [buf, cbsaIdx] = await Promise.all([
			localPath
				? (log('local', `reading ${localPath}`), Promise.resolve(readFileSync(localPath)))
				: fetchFirstWorking(HVS_CANDIDATES, (u) => `hvs_${u.split('/').pop()}`),
			loadCbsaIndex()
		]);

		const wb = XLSX.read(buf, { type: 'buffer' });
		const sheet = wb.Sheets[wb.SheetNames[0]];
		const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });

		// Find every panel: a header row whose col-1 cell contains "Metropolitan Statistical Area".
		// Each panel has its own set of year/quarter columns.
		interface Panel {
			headerRow: number;
			periods: Array<{ col: number; year: number; quarter: number }>;
		}
		const panels: Panel[] = [];
		for (let i = 0; i < aoa.length; i++) {
			const row = aoa[i];
			if (!Array.isArray(row)) continue;
			const cell1 = row[1];
			if (typeof cell1 !== 'string') continue;
			if (!/metropolitan\s+statistical\s+area/i.test(cell1)) continue;

			const periods: Panel['periods'] = [];
			for (let c = 2; c < row.length; c++) {
				const cell = row[c];
				if (cell === null || cell === undefined) continue;
				const parsed = parsePeriodLabel(String(cell));
				if (parsed) periods.push({ col: c, ...parsed });
			}
			if (periods.length > 0) panels.push({ headerRow: i, periods });
		}
		log('panels', `found ${panels.length} panels, ${panels.flatMap((p) => p.periods).length} total period columns`);

		const toInsert = new Map<string, VacancyRow>(); // dedupe by (year|quarter|cbsa)
		const unmatched = new Map<string, number>();

		for (let p = 0; p < panels.length; p++) {
			const panel = panels[p];
			const nextHeaderRow = panels[p + 1]?.headerRow ?? aoa.length;
			for (let r = panel.headerRow + 1; r < nextHeaderRow; r++) {
				const row = aoa[r];
				if (!Array.isArray(row)) continue;
				const nameRaw = row[1];
				if (typeof nameRaw !== 'string') continue;
				const normName = normalizeName(nameRaw);
				if (!normName || normName.length < 3) continue;

				// Resolve to a CBSA code
				let cbsa = MANUAL_NAME_TO_CBSA[normName] ?? cbsaIdx.exact.get(normName);
				if (!cbsa) {
					const stripped = normName.replace(/\s+(metro|micro)\s+area$/, '');
					cbsa = MANUAL_NAME_TO_CBSA[stripped] ?? cbsaIdx.exact.get(stripped);
				}
				if (!cbsa) {
					cbsa = looseMatch(normName, cbsaIdx) ?? undefined;
				}
				if (!cbsa) {
					unmatched.set(normName, (unmatched.get(normName) ?? 0) + 1);
					continue;
				}

				for (const period of panel.periods) {
					const v = row[period.col];
					if (v === null || v === undefined || v === '') continue;
					const pct = Number(String(v).replace(/[^\d.]/g, ''));
					if (!Number.isFinite(pct) || pct < 0 || pct > 100) continue;
					const key = `${period.year}|${period.quarter}|${cbsa}`;
					toInsert.set(key, {
						year: period.year,
						quarter: period.quarter,
						cbsaCode: cbsa,
						rentalVacancyPct: pct.toFixed(2)
					});
				}
			}
		}

		const rows = Array.from(toInsert.values());
		log('prep', `ready to upsert ${rows.length} vacancy_rates rows`);
		if (unmatched.size > 0) {
			log(
				'warn',
				`${unmatched.size} MSA names had no CBSA match; add to MANUAL_NAME_TO_CBSA if needed`
			);
			const sample = Array.from(unmatched.keys()).slice(0, 8);
			for (const s of sample) log('warn', `  unmatched: "${s}"`);
		}

		let upserted = 0;
		await chunk(rows, 1000, async (batch) => {
			await db
				.insert(vacancyRates)
				.values(batch)
				.onConflictDoUpdate({
					target: [vacancyRates.year, vacancyRates.quarter, vacancyRates.cbsaCode],
					set: {
						rentalVacancyPct: sql.raw(`excluded.${vacancyRates.rentalVacancyPct.name}`)
					}
				});
			upserted += batch.length;
		});
		log('done', `upserted ${upserted} vacancy_rates rows`);
	} finally {
		await close();
	}
}

await main();
