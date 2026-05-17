// Pure CSV parser + validator for the hud_fmr upload. Parallels vacancy-csv.ts.
// Header (case- and order-insensitive): year, county_fips, apt_type, fmr_cents.
// `fmr_dollars` is accepted as a convenience alternative to `fmr_cents`.

import { parse } from 'csv-parse/sync';
import { APT_TYPES, type AptType } from '$lib/shared/apt-types';

export interface FmrRowInput {
	year: number;
	countyFips: string; // 5-digit, zero-padded
	aptType: AptType;
	fmrCents: number; // 10_000..1_500_000
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
	validRows: FmrRowInput[];
	errors: RowError[];
	warnings: RowWarning[];
}

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 50_000;

const REQUIRED_HEADERS = ['year', 'county_fips', 'apt_type'] as const;
const ALLOWED_AMOUNT_HEADERS = ['fmr_cents', 'fmr_dollars'] as const;
const MIN_CENTS = 10_000;
const MAX_CENTS = 1_500_000;

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

export function parseFmrCsv(raw: string | Buffer | Uint8Array): ParseResult {
	const errors: RowError[] = [];
	const warnings: RowWarning[] = [];
	const validRows: FmrRowInput[] = [];

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
	const amountHeader = ALLOWED_AMOUNT_HEADERS.find((h) => header.includes(h));
	const missingRequired = REQUIRED_HEADERS.filter((h) => !header.includes(h));
	const unknown = header.filter(
		(h) => !REQUIRED_HEADERS.includes(h as never) && !ALLOWED_AMOUNT_HEADERS.includes(h as never)
	);
	if (missingRequired.length > 0 || !amountHeader || unknown.length > 0) {
		const parts: string[] = [];
		if (missingRequired.length) parts.push(`missing: ${missingRequired.join(', ')}`);
		if (!amountHeader) parts.push('missing: one of fmr_cents / fmr_dollars');
		if (unknown.length) parts.push(`unknown: ${unknown.join(', ')}`);
		return {
			ok: false,
			validRows: [],
			errors: [
				{
					line: 1,
					message: `Header must include: ${REQUIRED_HEADERS.join(', ')}, plus one of ${ALLOWED_AMOUNT_HEADERS.join(' | ')} (${parts.join('; ')})`
				}
			],
			warnings: []
		};
	}

	const idx = {
		year: header.indexOf('year'),
		county_fips: header.indexOf('county_fips'),
		apt_type: header.indexOf('apt_type'),
		amount: header.indexOf(amountHeader)
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
			county_fips: row[idx.county_fips]?.trim() ?? '',
			apt_type: row[idx.apt_type]?.trim() ?? '',
			amount: row[idx.amount]?.trim() ?? ''
		};

		if (!cells.year && !cells.county_fips && !cells.apt_type && !cells.amount) continue;

		const year = Number(cells.year);
		if (!Number.isInteger(year) || year < 2000 || year > cy + 1) {
			errors.push({
				line,
				message: `year must be an integer in [2000, ${cy + 1}] (got "${cells.year}")`
			});
			continue;
		}

		const countyDigits = cells.county_fips.replace(/\D/g, '');
		if (countyDigits.length === 0) {
			errors.push({ line, message: 'county_fips is required' });
			continue;
		}
		const countyFips = countyDigits.padStart(5, '0');
		if (countyFips.length !== 5) {
			errors.push({ line, message: `county_fips must be 5 digits (got "${cells.county_fips}")` });
			continue;
		}

		const aptRaw = cells.apt_type.toLowerCase().replace(/\s+/g, '_');
		if (!APT_TYPES.includes(aptRaw as AptType)) {
			errors.push({
				line,
				message: `apt_type must be one of ${APT_TYPES.join(' | ')} (got "${cells.apt_type}")`
			});
			continue;
		}
		const aptType = aptRaw as AptType;

		// Amount: dollars → cents conversion if using fmr_dollars.
		const amountStr = cells.amount.replace(/[$,\s]/g, '');
		const amountNum = Number(amountStr);
		if (!Number.isFinite(amountNum) || amountNum <= 0) {
			errors.push({
				line,
				message: `${amountHeader} must be a positive number (got "${cells.amount}")`
			});
			continue;
		}
		const fmrCents =
			amountHeader === 'fmr_dollars' ? Math.round(amountNum * 100) : Math.round(amountNum);
		if (fmrCents < MIN_CENTS || fmrCents > MAX_CENTS) {
			errors.push({
				line,
				message: `${amountHeader} out of range [$${MIN_CENTS / 100}, $${MAX_CENTS / 100}] (got "${cells.amount}")`
			});
			continue;
		}

		if (year > cy) warnings.push({ line, message: `year ${year} is in the future` });

		const pk = `${year}|${countyFips}|${aptType}`;
		const prior = seenPk.get(pk);
		if (prior !== undefined) {
			warnings.push({
				line,
				message: `duplicate of (year=${year}, county=${countyFips}, apt=${aptType}) first seen at line ${prior}; later row wins`
			});
			const existingIdx = validRows.findIndex(
				(v) => v.year === year && v.countyFips === countyFips && v.aptType === aptType
			);
			if (existingIdx >= 0) {
				validRows[existingIdx] = { year, countyFips, aptType, fmrCents };
				continue;
			}
		}
		seenPk.set(pk, line);
		validRows.push({ year, countyFips, aptType, fmrCents });
	}

	return { ok: errors.length === 0, validRows, errors, warnings };
}
