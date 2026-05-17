// Pure CSV parser + validator for the vacancy_rates upload.
// No DB in this module — the caller handles diff queries and upserts so we stay testable.

import { parse } from 'csv-parse/sync';

export interface VacancyRowInput {
	year: number;
	quarter: number;
	cbsaCode: string; // 5-digit, zero-padded
	rentalVacancyPct: number; // 0..100, 2 decimals
}

export interface RowError {
	line: number; // 1-indexed line in the source file (header = line 1)
	message: string;
}

export interface RowWarning {
	line: number;
	message: string;
}

export interface ParseResult {
	ok: boolean;
	validRows: VacancyRowInput[];
	errors: RowError[];
	warnings: RowWarning[];
}

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_ROWS = 50_000;

const REQUIRED_HEADERS = ['year', 'quarter', 'cbsa_code', 'rental_vacancy_pct'] as const;

function normHeader(h: string): string {
	return h.trim().toLowerCase();
}

function currentYear(): number {
	return new Date().getUTCFullYear();
}

export function isLikelyBinary(buf: Buffer | Uint8Array): boolean {
	const sniff = buf.slice(0, Math.min(1024, buf.length));
	for (const b of sniff) if (b === 0) return true;
	return false;
}

export function stripBom(s: string): string {
	return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function parseVacancyCsv(raw: string | Buffer | Uint8Array): ParseResult {
	const errors: RowError[] = [];
	const warnings: RowWarning[] = [];
	const validRows: VacancyRowInput[] = [];

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
		quarter: header.indexOf('quarter'),
		cbsa_code: header.indexOf('cbsa_code'),
		rental_vacancy_pct: header.indexOf('rental_vacancy_pct')
	};

	const cy = currentYear();
	const seenPk = new Map<string, number>(); // pk -> first-seen line

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
		const line = i + 2; // +1 for header, +1 for 1-indexing
		const row = dataRows[i];
		const cells = {
			year: row[idx.year]?.trim() ?? '',
			quarter: row[idx.quarter]?.trim() ?? '',
			cbsa_code: row[idx.cbsa_code]?.trim() ?? '',
			rental_vacancy_pct: row[idx.rental_vacancy_pct]?.trim() ?? ''
		};

		// Skip entirely blank lines (all cells empty)
		if (!cells.year && !cells.quarter && !cells.cbsa_code && !cells.rental_vacancy_pct) {
			continue;
		}

		const year = Number(cells.year);
		if (!Number.isInteger(year) || year < 2000 || year > cy + 1) {
			errors.push({ line, message: `year must be an integer in [2000, ${cy + 1}] (got "${cells.year}")` });
			continue;
		}

		const quarter = Number(cells.quarter);
		if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
			errors.push({ line, message: `quarter must be 1..4 (got "${cells.quarter}")` });
			continue;
		}

		const cbsaDigits = cells.cbsa_code.replace(/\D/g, '');
		if (cbsaDigits.length === 0) {
			errors.push({ line, message: 'cbsa_code is required' });
			continue;
		}
		const cbsa = cbsaDigits.padStart(5, '0');
		if (cbsa.length !== 5) {
			errors.push({ line, message: `cbsa_code must be 5 digits (got "${cells.cbsa_code}")` });
			continue;
		}

		const pctStr = cells.rental_vacancy_pct.replace(/%\s*$/, '').trim();
		const pct = Number(pctStr);
		if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
			errors.push({ line, message: `rental_vacancy_pct must be 0..100 (got "${cells.rental_vacancy_pct}")` });
			continue;
		}
		const rounded = Math.round(pct * 100) / 100;

		// Warnings (still accepted as valid)
		if (year > cy) {
			warnings.push({ line, message: `year ${year} is in the future` });
		}
		const pk = `${year}|${quarter}|${cbsa}`;
		const prior = seenPk.get(pk);
		if (prior !== undefined) {
			warnings.push({
				line,
				message: `duplicate of (year=${year}, quarter=${quarter}, cbsa=${cbsa}) first seen at line ${prior}; later row wins`
			});
			// Later row wins — overwrite in validRows
			const existingIdx = validRows.findIndex(
				(v) => v.year === year && v.quarter === quarter && v.cbsaCode === cbsa
			);
			if (existingIdx >= 0) {
				validRows[existingIdx] = {
					year,
					quarter,
					cbsaCode: cbsa,
					rentalVacancyPct: rounded
				};
				continue;
			}
		}
		seenPk.set(pk, line);
		validRows.push({ year, quarter, cbsaCode: cbsa, rentalVacancyPct: rounded });
	}

	return { ok: errors.length === 0, validRows, errors, warnings };
}
