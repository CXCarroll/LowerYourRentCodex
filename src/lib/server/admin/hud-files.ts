// Fetch HUD FMR and SAFMR data from HUD's PUBLIC file downloads — no API token
// required. HUD publishes the same underlying data as free XLSX files at
// https://www.huduser.gov/portal/datasets/fmr.html and
// https://www.huduser.gov/portal/datasets/fmr/smallarea/index.html — these are
// not gated behind the HUD User API signup.
//
// We cache parsed rows in-process for 24h because the files don't change
// mid-year and parsing XLSX is not free.

import * as XLSX from 'xlsx';
import type { AptType } from '$lib/shared/apt-types';

export const HUD_FMR_AVAILABLE_YEARS = [
	2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026
] as const;
export type HudFmrYear = (typeof HUD_FMR_AVAILABLE_YEARS)[number];

export interface HudFmrRow {
	year: number;
	countyFips: string; // 5-digit
	aptType: AptType;
	fmrCents: number;
}

export interface HudSafmrRow {
	year: number;
	cbsaCode: string; // 5-digit
	zip: string; // 5-digit
	aptType: AptType;
	fmrCents: number;
}

export class HudFileError extends Error {
	constructor(
		public status: number,
		public urlsTried: string[],
		message: string
	) {
		super(message);
		this.name = 'HudFileError';
	}
}

const REQUEST_TIMEOUT_MS = 30_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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

// HUD filename conventions drift over the years ("FY25_FMRs_revised.xlsx",
// "FY2025_FMRs.xlsx", etc.) so we try a few candidate URLs and use the first
// one that 200s. The order here matters — most recent convention first.
function fmrCandidateUrls(year: number): string[] {
	const yy = String(year).slice(-2);
	const yyyy = String(year);
	const base = 'https://www.huduser.gov/portal/datasets/fmr';
	return [
		`${base}/fmr${yyyy}/FY${yy}_FMRs_revised.xlsx`,
		`${base}/fmr${yyyy}/FY${yy}_FMRs.xlsx`,
		`${base}/fmr${yyyy}/FY${yyyy}_FMRs_revised.xlsx`,
		`${base}/fmr${yyyy}/FY${yyyy}_FMRs.xlsx`,
		`${base}/fmr${yyyy}/FMR_County_${yyyy}.xlsx`,
		`${base}/fmr${yyyy}/FMR_County_FY${yy}.xlsx`,
		// Lowercase + alternative subdirs HUD has used historically.
		`${base}/fy${yyyy}/FY${yy}_FMRs_revised.xlsx`,
		`${base}/fy${yyyy}/FY${yy}_FMRs.xlsx`,
		`${base}/fmr${yyyy}_code/FY${yy}_FMRs.xlsx`,
		`${base}/fmr${yy}/FY${yy}_FMRs.xlsx`
	];
}

function safmrCandidateUrls(year: number): string[] {
	const yy = String(year).slice(-2);
	const yyyy = String(year);
	const base = 'https://www.huduser.gov/portal/datasets/fmr/smallarea';
	return [
		`${base}/FY${yyyy}_SAFMRs_revised.xlsx`,
		`${base}/FY${yyyy}_SAFMRs.xlsx`,
		`${base}/FY${yy}_SAFMRs_revised.xlsx`,
		`${base}/FY${yy}_SAFMRs.xlsx`,
		`${base}/fy${yyyy}_safmrs_revised.xlsx`,
		`${base}/fy${yyyy}_safmrs.xlsx`,
		// Alternative paths seen across HUD redesigns.
		`${base}/fy${yyyy}/FY${yy}_SAFMRs.xlsx`,
		`${base}/FY${yy}SAFMRs.xlsx`,
		`https://www.huduser.gov/portal/datasets/fmr/fmr${yyyy}/FY${yy}_SAFMRs.xlsx`
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
			if (resp.ok) {
				return { buf: await resp.arrayBuffer(), url };
			}
			errors.push(`${resp.status} ${url}`);
		} catch (err) {
			errors.push(`${(err as Error).message} ${url}`);
		}
	}
	throw new HudFileError(
		404,
		urls,
		`Could not fetch any HUD file. Tried:\n  ${errors.join('\n  ')}`
	);
}

function normalizeHeader(h: unknown): string {
	return String(h ?? '')
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, '_')
		.replace(/[^a-z0-9_]/g, '');
}

/**
 * Find the apt-type -> column name mapping for an FMR sheet. HUD's bedroom
 * columns are typically named "fmr_0" / "fmr_1" / ... or
 * "fmr25_0" / ... with a year suffix, so we match by suffix digit.
 */
function findBedroomColumns(headers: string[]): Partial<Record<AptType, string>> {
	const map: Partial<Record<AptType, string>> = {};
	const targets: Array<{ digit: string; aptType: AptType }> = [
		{ digit: '0', aptType: 'studio' },
		{ digit: '1', aptType: '1br' },
		{ digit: '2', aptType: '2br' },
		{ digit: '3', aptType: '3br' },
		{ digit: '4', aptType: '4br_plus' }
	];
	for (const { digit, aptType } of targets) {
		// Accept fmr_0, fmr25_0, safmr_0, safmr_0br, etc. Require underscore+digit
		// boundary so "fmr_2br" matches 2, not 0.
		const match = headers.find((h) =>
			new RegExp(`^(sa)?fmr(_?\\d{0,4})?_${digit}(br)?$`).test(h)
		);
		if (match) map[aptType] = match;
	}
	return map;
}

function readFmrWorkbook(buf: ArrayBuffer, year: number): HudFmrRow[] {
	const wb = XLSX.read(buf, { type: 'array' });
	const sheetName = wb.SheetNames[0];
	if (!sheetName) throw new HudFileError(500, [], 'FMR workbook has no sheets.');
	const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], {
		defval: null
	});
	if (rows.length === 0) throw new HudFileError(500, [], 'FMR sheet is empty.');

	// Normalize headers on every row's keys into a lookup.
	const originalHeaders = Object.keys(rows[0]);
	const headerMap = new Map<string, string>(); // normalized -> original
	for (const h of originalHeaders) {
		headerMap.set(normalizeHeader(h), h);
	}
	const normalizedHeaders = Array.from(headerMap.keys());

	const fipsKey =
		headerMap.get('fips') ??
		headerMap.get('fips_code') ??
		headerMap.get('fipscounty') ??
		headerMap.get('state_county') ??
		headerMap.get('county_code');
	if (!fipsKey) {
		throw new HudFileError(
			500,
			[],
			`FMR sheet missing FIPS column. Headers: ${originalHeaders.join(', ')}`
		);
	}
	const bedroomCols = findBedroomColumns(normalizedHeaders);
	if (Object.keys(bedroomCols).length === 0) {
		throw new HudFileError(
			500,
			[],
			`FMR sheet missing bedroom columns (fmr_0..fmr_4). Headers: ${originalHeaders.join(', ')}`
		);
	}
	// Resolve normalized bedroom keys back to original header names.
	const originalBedroomCols: Partial<Record<AptType, string>> = {};
	for (const [apt, normalized] of Object.entries(bedroomCols) as Array<[AptType, string]>) {
		const original = headerMap.get(normalized);
		if (original) originalBedroomCols[apt] = original;
	}

	const out: HudFmrRow[] = [];
	for (const row of rows) {
		const fipsRaw = row[fipsKey];
		const countyFips = coerceFips(fipsRaw);
		if (!countyFips) continue;
		for (const [aptType, col] of Object.entries(originalBedroomCols) as Array<[AptType, string]>) {
			const cents = toCents(row[col]);
			if (cents === null) continue;
			out.push({ year, countyFips, aptType, fmrCents: cents });
		}
	}
	return dedupeFmrRows(out);
}

function readSafmrWorkbook(buf: ArrayBuffer, year: number): HudSafmrRow[] {
	const wb = XLSX.read(buf, { type: 'array' });
	const sheetName = wb.SheetNames[0];
	if (!sheetName) throw new HudFileError(500, [], 'SAFMR workbook has no sheets.');
	const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], {
		defval: null
	});
	if (rows.length === 0) throw new HudFileError(500, [], 'SAFMR sheet is empty.');

	const originalHeaders = Object.keys(rows[0]);
	const headerMap = new Map<string, string>();
	for (const h of originalHeaders) headerMap.set(normalizeHeader(h), h);
	const normalizedHeaders = Array.from(headerMap.keys());

	const zipKey =
		headerMap.get('zip') ??
		headerMap.get('zipcode') ??
		headerMap.get('zip_code') ??
		headerMap.get('zcta');
	const cbsaKey =
		headerMap.get('cbsa') ??
		headerMap.get('cbsa_code') ??
		headerMap.get('hud_area_code') ??
		headerMap.get('hud_area') ??
		headerMap.get('metro_code');
	if (!zipKey || !cbsaKey) {
		throw new HudFileError(
			500,
			[],
			`SAFMR sheet missing ZIP or CBSA column. Headers: ${originalHeaders.join(', ')}`
		);
	}
	const bedroomCols = findBedroomColumns(normalizedHeaders);
	const originalBedroomCols: Partial<Record<AptType, string>> = {};
	for (const [apt, normalized] of Object.entries(bedroomCols) as Array<[AptType, string]>) {
		const original = headerMap.get(normalized);
		if (original) originalBedroomCols[apt] = original;
	}

	const out: HudSafmrRow[] = [];
	for (const row of rows) {
		const zipRaw = row[zipKey];
		const cbsaRaw = row[cbsaKey];
		const zip = coerceZip(zipRaw);
		const cbsa = coerceCbsa(cbsaRaw);
		if (!zip || !cbsa) continue;
		for (const [aptType, col] of Object.entries(originalBedroomCols) as Array<[AptType, string]>) {
			const cents = toCents(row[col]);
			if (cents === null) continue;
			out.push({ year, cbsaCode: cbsa, zip, aptType, fmrCents: cents });
		}
	}
	return out;
}

function coerceFips(raw: unknown): string | null {
	if (raw === null || raw === undefined) return null;
	const s = typeof raw === 'number' ? String(raw) : String(raw);
	const digits = s.replace(/\D/g, '');
	if (digits.length < 5) return null;
	return digits.slice(0, 5).padStart(5, '0');
}

function coerceZip(raw: unknown): string | null {
	if (raw === null || raw === undefined) return null;
	const s = typeof raw === 'number' ? String(raw) : String(raw);
	const digits = s.replace(/\D/g, '');
	if (digits.length === 0) return null;
	return digits.padStart(5, '0').slice(0, 5);
}

function coerceCbsa(raw: unknown): string | null {
	if (raw === null || raw === undefined) return null;
	const s = typeof raw === 'number' ? String(raw) : String(raw);
	const digits = s.replace(/\D/g, '');
	if (digits.length < 5) return null;
	return digits.slice(0, 5);
}

function toCents(dollars: unknown): number | null {
	if (dollars === null || dollars === undefined) return null;
	const n = typeof dollars === 'number' ? dollars : Number(String(dollars).replace(/[$,\s]/g, ''));
	if (!Number.isFinite(n) || n <= 0) return null;
	return Math.round(n * 100);
}

function dedupeFmrRows(rows: HudFmrRow[]): HudFmrRow[] {
	const seen = new Set<string>();
	const out: HudFmrRow[] = [];
	for (const r of rows) {
		const k = `${r.countyFips}|${r.aptType}`;
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(r);
	}
	return out;
}

/** Fetches + parses a full year of county-level FMR. Cached 24h. */
export async function fetchFmrRows(year: number): Promise<HudFmrRow[]> {
	const key = `fmr|${year}`;
	const cached = cacheGet<HudFmrRow[]>(key);
	if (cached) return cached;
	const { buf } = await fetchFirstOk(fmrCandidateUrls(year));
	const rows = readFmrWorkbook(buf, year);
	cacheSet(key, rows);
	return rows;
}

/** Fetches + parses a full year of SAFMR (ZIP-level) rows. Cached 24h. */
export async function fetchSafmrRows(year: number): Promise<HudSafmrRow[]> {
	const key = `safmr|${year}`;
	const cached = cacheGet<HudSafmrRow[]>(key);
	if (cached) return cached;
	const { buf } = await fetchFirstOk(safmrCandidateUrls(year));
	const rows = readSafmrWorkbook(buf, year);
	cacheSet(key, rows);
	return rows;
}

// Exposed for tests: lets a unit test inject a fake XLSX buffer.
export const __test = { readFmrWorkbook, readSafmrWorkbook, fmrCandidateUrls, safmrCandidateUrls };
