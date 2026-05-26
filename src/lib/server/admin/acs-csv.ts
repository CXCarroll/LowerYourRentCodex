// Pure CSV parser + validator for acs_rent uploads.
// Header: year, geo_level, geo_id, median_gross_rent_cents, sample_size.
// Accepts aggregate ZCTA rows and PUMS recent-mover PUMA rows.

import { parse } from 'csv-parse/sync';

export interface AcsRentRowInput {
	year: number;
	geoLevel: 'zcta' | 'puma';
	geoId: string; // 5-digit ZCTA or 7-digit state+PUMA
	medianGrossRentCents: number;
	sampleSize: number | null;
}

export interface RowError {
	line: number;
	message: string;
}

export interface RowWarning {
	line: number;
	message: string;
}

export interface ParseResult {
	ok: boolean;
	validRows: AcsRentRowInput[];
	errors: RowError[];
	warnings: RowWarning[];
}

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 50_000;

const REQUIRED_HEADERS = [
	'year',
	'geo_level',
	'geo_id',
	'median_gross_rent_cents',
	'sample_size'
] as const;
const MIN_RENT_CENTS = 10_000;
const MAX_RENT_CENTS = 1_500_000;

function normHeader(h: string): string {
	return h.trim().toLowerCase();
}

function currentYear(): number {
	return new Date().getUTCFullYear();
}

function isLikelyBinary(buf: Buffer | Uint8Array): boolean {
	const sniff = buf.slice(0, Math.min(1024, buf.length));
	for (const b of sniff) if (b === 0) return true;
	return false;
}

function stripBom(s: string): string {
	return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function parseOptionalSampleSize(raw: string): number | null | 'invalid' {
	const normalized = raw.trim().toLowerCase();
	if (!normalized || normalized === 'null' || normalized === 'na' || normalized === 'n/a') return null;
	const n = Number(normalized.replace(/,/g, ''));
	if (!Number.isInteger(n) || n <= 0) return 'invalid';
	return n;
}

export function parseAcsRentCsv(raw: string | Buffer | Uint8Array): ParseResult {
	const errors: RowError[] = [];
	const warnings: RowWarning[] = [];
	const validRows: AcsRentRowInput[] = [];

	let text: string;
	if (typeof raw === 'string') {
		text = raw;
	} else {
		if (isLikelyBinary(raw)) {
			return {
				ok: false,
				validRows: [],
				errors: [{ line: 0, message: 'File appears to be binary, not CSV.' }],
				warnings: []
			};
		}
		text = new TextDecoder('utf-8', { fatal: false }).decode(raw);
	}

	text = stripBom(text);
	if (text.trim().length === 0) {
		return {
			ok: false,
			validRows: [],
			errors: [{ line: 0, message: 'CSV is empty.' }],
			warnings: []
		};
	}

	let records: string[][];
	try {
		records = parse(text, {
			skip_empty_lines: true,
			trim: true,
			relax_column_count: true
		}) as string[][];
	} catch (err) {
		return {
			ok: false,
			validRows: [],
			errors: [{ line: 0, message: `CSV parse error: ${(err as Error).message}` }],
			warnings: []
		};
	}

	if (records.length === 0) {
		return {
			ok: false,
			validRows: [],
			errors: [{ line: 0, message: 'CSV has no rows.' }],
			warnings: []
		};
	}

	const header = records[0].map(normHeader);
	const missing = REQUIRED_HEADERS.filter((h) => !header.includes(h));
	const extras = header.filter((h) => !REQUIRED_HEADERS.includes(h as never));
	if (missing.length > 0 || extras.length > 0) {
		const parts: string[] = [];
		if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
		if (extras.length) parts.push(`unknown: ${extras.join(', ')}`);
		return {
			ok: false,
			validRows: [],
			errors: [
				{
					line: 1,
					message: `Header must be exactly: ${REQUIRED_HEADERS.join(', ')} (${parts.join('; ')})`
				}
			],
			warnings: []
		};
	}

	const idx = {
		year: header.indexOf('year'),
		geo_level: header.indexOf('geo_level'),
		geo_id: header.indexOf('geo_id'),
		median_gross_rent_cents: header.indexOf('median_gross_rent_cents'),
		sample_size: header.indexOf('sample_size')
	};

	const cy = currentYear();
	const seenPk = new Map<string, number>();

	const dataRows = records.slice(1);
	if (dataRows.length > MAX_ROWS) {
		return {
			ok: false,
			validRows: [],
			errors: [{ line: 0, message: `Too many rows: ${dataRows.length} > ${MAX_ROWS}` }],
			warnings: []
		};
	}

	for (let i = 0; i < dataRows.length; i++) {
		const line = i + 2;
		const row = dataRows[i];
		const cells = {
			year: row[idx.year]?.trim() ?? '',
			geo_level: row[idx.geo_level]?.trim() ?? '',
			geo_id: row[idx.geo_id]?.trim() ?? '',
			median_gross_rent_cents: row[idx.median_gross_rent_cents]?.trim() ?? '',
			sample_size: row[idx.sample_size]?.trim() ?? ''
		};

		if (
			!cells.year &&
			!cells.geo_level &&
			!cells.geo_id &&
			!cells.median_gross_rent_cents &&
			!cells.sample_size
		) {
			continue;
		}

		const year = Number(cells.year);
		if (!Number.isInteger(year) || year < 2000 || year > cy + 1) {
			errors.push({
				line,
				message: `year must be an integer in [2000, ${cy + 1}] (got "${cells.year}")`
			});
			continue;
		}

		const geoLevel = cells.geo_level.toLowerCase();
		if (geoLevel !== 'zcta' && geoLevel !== 'puma') {
			errors.push({
				line,
				message: `geo_level must be zcta or puma (got "${cells.geo_level}")`
			});
			continue;
		}

		const geoDigits = cells.geo_id.replace(/\D/g, '');
		if (geoDigits.length === 0) {
			errors.push({ line, message: 'geo_id is required' });
			continue;
		}
		const geoId = geoLevel === 'zcta' ? geoDigits.padStart(5, '0') : geoDigits;
		const validGeoId =
			(geoLevel === 'zcta' && geoId.length === 5) ||
			(geoLevel === 'puma' && /^\d{7}$/.test(geoId));
		if (!validGeoId) {
			const label = geoLevel === 'zcta' ? '5-digit ZCTA' : '7-digit state+PUMA id';
			errors.push({ line, message: `geo_id must be a ${label} (got "${cells.geo_id}")` });
			continue;
		}

		const rentNum = Number(cells.median_gross_rent_cents.replace(/[$,\s]/g, ''));
		if (!Number.isFinite(rentNum) || rentNum <= 0) {
			errors.push({
				line,
				message: `median_gross_rent_cents must be a positive number (got "${cells.median_gross_rent_cents}")`
			});
			continue;
		}
		const medianGrossRentCents = Math.round(rentNum);
		if (medianGrossRentCents < MIN_RENT_CENTS || medianGrossRentCents > MAX_RENT_CENTS) {
			errors.push({
				line,
				message: `median_gross_rent_cents out of range [$${MIN_RENT_CENTS / 100}, $${MAX_RENT_CENTS / 100}] (got "${cells.median_gross_rent_cents}")`
			});
			continue;
		}

		const sampleSize = parseOptionalSampleSize(cells.sample_size);
		if (sampleSize === 'invalid') {
			errors.push({
				line,
				message: `sample_size must be a positive integer or blank (got "${cells.sample_size}")`
			});
			continue;
		}

		if (year > cy) warnings.push({ line, message: `year ${year} is in the future` });

		const pk = `${year}|${geoLevel}|${geoId}`;
		const prior = seenPk.get(pk);
		if (prior !== undefined) {
			warnings.push({
				line,
				message: `duplicate of (year=${year}, geo_level=${geoLevel}, geo_id=${geoId}) first seen at line ${prior}; later row wins`
			});
			const existingIdx = validRows.findIndex(
				(v) => v.year === year && v.geoLevel === geoLevel && v.geoId === geoId
			);
			if (existingIdx >= 0) {
				validRows[existingIdx] = {
					year,
					geoLevel: 'zcta',
					geoId,
					medianGrossRentCents,
					sampleSize
				};
				continue;
			}
		}
		seenPk.set(pk, line);
		validRows.push({
			year,
			geoLevel,
			geoId,
			medianGrossRentCents,
			sampleSize
		});
	}

	return { ok: errors.length === 0, validRows, errors, warnings };
}
