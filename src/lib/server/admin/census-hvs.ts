// Census Housing Vacancy Survey (HVS) — quarterly rental vacancy rates by MSA.
//
// Source: https://www.census.gov/housing/hvs/data/rates.html — the Census
// Bureau publishes free quarterly XLSX tables of rental vacancy rates for
// the 75 largest metros. No API key required.
//
// We parse the historical time-series table ("tab4_msa_msa.xlsx") rather than
// one-quarter-at-a-time tables because the time-series file is stable across
// quarters and lets us filter client-side.

import * as XLSX from 'xlsx';

export interface HvsVacancyRow {
	year: number;
	quarter: number; // 1..4
	cbsaCode: string; // 5-digit
	rentalVacancyPct: number; // 0..100, 2 decimals
}

export class HvsFileError extends Error {
	constructor(
		public status: number,
		public urlsTried: string[],
		message: string
	) {
		super(message);
		this.name = 'HvsFileError';
	}
}

const REQUEST_TIMEOUT_MS = 30_000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // weekly — HVS is quarterly

interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}
const cache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | undefined {
	const entry = cache.get(key);
	if (!entry) return undefined;
	if (entry.expiresAt < Date.now()) {
		cache.delete(key);
		return undefined;
	}
	return entry.value as T;
}
function cacheSet<T>(key: string, value: T): void {
	cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Census HVS publishes a historical MSA rental-vacancy time-series at a URL
// that has drifted across redesigns. Try the known forms in order.
function candidateUrls(): string[] {
	return [
		// Current annual MSA tables (most recent year appears to live here).
		'https://www.census.gov/housing/hvs/files/annual24/ann24t4.xlsx',
		'https://www.census.gov/housing/hvs/files/annual23/ann23t4.xlsx',
		'https://www.census.gov/housing/hvs/files/annual22/ann22t4.xlsx',
		// Historical / time-series forms the Census site has used.
		'https://www.census.gov/housing/hvs/data/histtab18.xlsx',
		'https://www2.census.gov/programs-surveys/hvs/tables/time-series/msa/tab4_msa_msa.xlsx',
		'https://www2.census.gov/programs-surveys/hvs/tables/annual/annual_msa_historical.xlsx',
		'https://www.census.gov/housing/hvs/data/rates/tab4_msa_msa.xlsx'
	];
}

async function fetchFirstOk(urls: string[]): Promise<{ buf: ArrayBuffer; url: string }> {
	const errors: string[] = [];
	for (const url of urls) {
		try {
			const resp = await fetch(url, {
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				redirect: 'follow'
			});
			if (resp.ok) return { buf: await resp.arrayBuffer(), url };
			errors.push(`${resp.status} ${url}`);
		} catch (err) {
			errors.push(`${(err as Error).message} ${url}`);
		}
	}
	throw new HvsFileError(
		404,
		urls,
		`Could not fetch Census HVS MSA table. Tried:\n  ${errors.join('\n  ')}`
	);
}

// Map Census HVS metro-area names to CBSA codes. HVS uses a fixed list of
// ~75 metros. This mapping covers the top-50 cities in our cities seed.
// Keys use lowercased, punctuation-squashed substrings for forgiving match.
const METRO_NAME_PATTERNS: Array<{ pattern: RegExp; cbsa: string }> = [
	{ pattern: /\bnew york\b.*\bnj\b/i, cbsa: '35620' },
	{ pattern: /\blos angeles\b.*\banaheim\b/i, cbsa: '31080' },
	{ pattern: /\blos angeles\b.*\blong beach\b/i, cbsa: '31080' },
	{ pattern: /\bchicago\b/i, cbsa: '16980' },
	{ pattern: /\bhouston\b/i, cbsa: '26420' },
	{ pattern: /\bphoenix\b/i, cbsa: '38060' },
	{ pattern: /\bphiladelphia\b/i, cbsa: '37980' },
	{ pattern: /\bsan antonio\b/i, cbsa: '41700' },
	{ pattern: /\bsan diego\b/i, cbsa: '41740' },
	{ pattern: /\bdallas\b.*\bfort worth\b/i, cbsa: '19100' },
	{ pattern: /\bsan jose\b/i, cbsa: '41940' },
	{ pattern: /\baustin\b/i, cbsa: '12420' },
	{ pattern: /\bjacksonville\b.*\bfl\b/i, cbsa: '27260' },
	{ pattern: /\bcolumbus\b.*\boh\b/i, cbsa: '18140' },
	{ pattern: /\bcharlotte\b/i, cbsa: '16740' },
	{ pattern: /\bindianapolis\b/i, cbsa: '26900' },
	{ pattern: /\bsan francisco\b.*\boakland\b/i, cbsa: '41860' },
	{ pattern: /\bseattle\b/i, cbsa: '42660' },
	{ pattern: /\bdenver\b/i, cbsa: '19740' },
	{ pattern: /\bwashington\b.*\bdc\b/i, cbsa: '47900' },
	{ pattern: /\bnashville\b/i, cbsa: '34980' },
	{ pattern: /\boklahoma city\b/i, cbsa: '36420' },
	{ pattern: /\bel paso\b/i, cbsa: '21340' },
	{ pattern: /\bboston\b/i, cbsa: '14460' },
	{ pattern: /\bportland\b.*\bor\b/i, cbsa: '38900' },
	{ pattern: /\blas vegas\b/i, cbsa: '29820' },
	{ pattern: /\bdetroit\b/i, cbsa: '19820' },
	{ pattern: /\bmemphis\b/i, cbsa: '32820' },
	{ pattern: /\blouisville\b/i, cbsa: '31140' },
	{ pattern: /\bbaltimore\b/i, cbsa: '12580' },
	{ pattern: /\bmilwaukee\b/i, cbsa: '33340' },
	{ pattern: /\balbuquerque\b/i, cbsa: '10740' },
	{ pattern: /\btucson\b/i, cbsa: '46060' },
	{ pattern: /\bfresno\b/i, cbsa: '23420' },
	{ pattern: /\bsacramento\b/i, cbsa: '40900' },
	{ pattern: /\bkansas city\b/i, cbsa: '28140' },
	{ pattern: /\batlanta\b/i, cbsa: '12060' },
	{ pattern: /\bomaha\b/i, cbsa: '36540' },
	{ pattern: /\bcolorado springs\b/i, cbsa: '17820' },
	{ pattern: /\braleigh\b/i, cbsa: '39580' },
	{ pattern: /\bvirginia beach\b/i, cbsa: '47260' },
	{ pattern: /\bmiami\b.*\bfort lauderdale\b/i, cbsa: '33100' },
	{ pattern: /\bminneapolis\b.*\bst\.?\s*paul\b/i, cbsa: '33460' },
	{ pattern: /\btulsa\b/i, cbsa: '46140' },
	{ pattern: /\bbakersfield\b/i, cbsa: '12540' },
	{ pattern: /\bwichita\b/i, cbsa: '48620' }
];

function matchCbsaByName(name: string): string | null {
	for (const { pattern, cbsa } of METRO_NAME_PATTERNS) {
		if (pattern.test(name)) return cbsa;
	}
	return null;
}

/**
 * Parse the Census HVS time-series MSA sheet. The workbook is a pivot-style
 * table with metros as rows and (year, quarter) as columns. We iterate every
 * cell, parsing the header to identify the period, and emit long-form rows.
 */
function readHvsWorkbook(buf: ArrayBuffer): HvsVacancyRow[] {
	const wb = XLSX.read(buf, { type: 'array' });
	const sheetName = wb.SheetNames[0];
	if (!sheetName) throw new HvsFileError(500, [], 'HVS workbook has no sheets.');
	const sheet = wb.Sheets[sheetName];
	// header: 1 returns arrays of raw cell values, including blank rows.
	const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });

	// Find the header row that contains period labels like "2025Q4" or "2025 Q4".
	let headerRowIndex = -1;
	let periodCols: Array<{ col: number; year: number; quarter: number }> = [];
	for (let i = 0; i < Math.min(rows.length, 20); i++) {
		const row = rows[i] ?? [];
		const periods: typeof periodCols = [];
		for (let c = 0; c < row.length; c++) {
			const parsed = parsePeriod(row[c]);
			if (parsed) periods.push({ col: c, year: parsed.year, quarter: parsed.quarter });
		}
		if (periods.length >= 4) {
			headerRowIndex = i;
			periodCols = periods;
			break;
		}
	}
	if (headerRowIndex < 0) {
		throw new HvsFileError(500, [], 'HVS sheet: could not locate period header row.');
	}

	// For each data row, look for a metro-name cell, map it to a CBSA, then
	// emit one HvsVacancyRow per periodCol.
	const out: HvsVacancyRow[] = [];
	for (let i = headerRowIndex + 1; i < rows.length; i++) {
		const row = rows[i] ?? [];
		// Find the first non-empty text cell as the metro label.
		let label = '';
		for (const cell of row) {
			if (typeof cell === 'string' && cell.trim().length > 0) {
				label = cell.trim();
				break;
			}
		}
		if (!label) continue;
		const cbsa = matchCbsaByName(label);
		if (!cbsa) continue;
		for (const { col, year, quarter } of periodCols) {
			const pct = toPct(row[col]);
			if (pct === null) continue;
			out.push({ year, quarter, cbsaCode: cbsa, rentalVacancyPct: pct });
		}
	}
	// Dedupe (year, quarter, cbsa) — keep last seen (lower rows in pivot often
	// have annual averages duplicating the metro label; prefer quarterly rows).
	const seen = new Map<string, HvsVacancyRow>();
	for (const r of out) {
		seen.set(`${r.year}|${r.quarter}|${r.cbsaCode}`, r);
	}
	return Array.from(seen.values());
}

function parsePeriod(cell: unknown): { year: number; quarter: number } | null {
	if (cell === null || cell === undefined) return null;
	const s = String(cell).trim();
	const m = s.match(/^(\d{4})\s*[-\s]*(?:Q|q|quarter\s*)(\d)$/i) ?? s.match(/^Q(\d)\s*(\d{4})$/i);
	if (!m) return null;
	let year: number;
	let quarter: number;
	if (m[1].length === 4) {
		year = Number(m[1]);
		quarter = Number(m[2]);
	} else {
		quarter = Number(m[1]);
		year = Number(m[2]);
	}
	if (!(year >= 2000 && year <= 2100)) return null;
	if (!(quarter >= 1 && quarter <= 4)) return null;
	return { year, quarter };
}

function toPct(raw: unknown): number | null {
	if (raw === null || raw === undefined) return null;
	const s = String(raw).trim().replace(/%$/, '');
	if (s.length === 0 || s === '-' || s === 'N' || s === 'NA') return null;
	const n = Number(s);
	if (!Number.isFinite(n) || n < 0 || n > 100) return null;
	return Math.round(n * 100) / 100;
}

/**
 * Fetch + parse the full HVS time-series table. Returns one row per
 * (year, quarter, cbsa) for every metro that matches our name mapping.
 * Cached for one week.
 */
export async function fetchHvsVacancy(): Promise<HvsVacancyRow[]> {
	const key = 'hvs|all';
	const cached = cacheGet<HvsVacancyRow[]>(key);
	if (cached) return cached;
	const { buf } = await fetchFirstOk(candidateUrls());
	const rows = readHvsWorkbook(buf);
	cacheSet(key, rows);
	return rows;
}

export const __test = { readHvsWorkbook, parsePeriod, matchCbsaByName, candidateUrls };
