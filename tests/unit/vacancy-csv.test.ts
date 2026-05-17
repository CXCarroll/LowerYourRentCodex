import { describe, expect, test } from 'bun:test';
import { parseVacancyCsv, stripBom, isLikelyBinary } from '../../src/lib/server/admin/vacancy-csv';

const HEADER = 'year,quarter,cbsa_code,rental_vacancy_pct';

function mk(...rows: string[]): string {
	return [HEADER, ...rows].join('\n');
}

describe('parseVacancyCsv — happy path', () => {
	test('parses 3 clean rows', () => {
		const r = parseVacancyCsv(mk('2024,1,35620,5.2', '2024,1,41860,3.6', '2024,1,26420,10.40'));
		expect(r.ok).toBe(true);
		expect(r.validRows).toEqual([
			{ year: 2024, quarter: 1, cbsaCode: '35620', rentalVacancyPct: 5.2 },
			{ year: 2024, quarter: 1, cbsaCode: '41860', rentalVacancyPct: 3.6 },
			{ year: 2024, quarter: 1, cbsaCode: '26420', rentalVacancyPct: 10.4 }
		]);
		expect(r.errors).toEqual([]);
		expect(r.warnings).toEqual([]);
	});
	test('strips trailing % sign', () => {
		const r = parseVacancyCsv(mk('2024,2,35620,6.1%'));
		expect(r.ok).toBe(true);
		expect(r.validRows[0].rentalVacancyPct).toBe(6.1);
	});
	test('zero-pads short cbsa_code', () => {
		const r = parseVacancyCsv(mk('2024,1,880,5'));
		expect(r.ok).toBe(true);
		expect(r.validRows[0].cbsaCode).toBe('00880');
	});
	test('rounds to 2 decimals', () => {
		const r = parseVacancyCsv(mk('2024,1,35620,5.234567'));
		expect(r.ok).toBe(true);
		expect(r.validRows[0].rentalVacancyPct).toBe(5.23);
	});
	test('accepts header in any order, case-insensitive', () => {
		const text = 'Quarter,Year,Rental_Vacancy_Pct,CBSA_Code\n1,2024,5.2,35620';
		const r = parseVacancyCsv(text);
		expect(r.ok).toBe(true);
		expect(r.validRows[0]).toEqual({
			year: 2024,
			quarter: 1,
			cbsaCode: '35620',
			rentalVacancyPct: 5.2
		});
	});
	test('skips entirely blank lines', () => {
		const r = parseVacancyCsv(mk('2024,1,35620,5.2', '', '2024,2,35620,5.5'));
		expect(r.ok).toBe(true);
		expect(r.validRows.length).toBe(2);
	});
	test('strips UTF-8 BOM', () => {
		const r = parseVacancyCsv('\uFEFF' + mk('2024,1,35620,5.2'));
		expect(r.ok).toBe(true);
		expect(r.validRows.length).toBe(1);
	});
});

describe('parseVacancyCsv — errors', () => {
	test('missing header columns', () => {
		const r = parseVacancyCsv('year,quarter,cbsa_code\n2024,1,35620');
		expect(r.ok).toBe(false);
		expect(r.errors[0].message).toMatch(/missing: rental_vacancy_pct/);
	});
	test('unknown header column', () => {
		const r = parseVacancyCsv(HEADER + ',extra\n2024,1,35620,5.2,x');
		expect(r.ok).toBe(false);
		expect(r.errors[0].message).toMatch(/unknown: extra/);
	});
	test('out-of-range quarter', () => {
		const r = parseVacancyCsv(mk('2024,5,35620,5.2'));
		expect(r.ok).toBe(false);
		expect(r.errors[0]).toEqual({ line: 2, message: expect.stringMatching(/quarter must be/) });
	});
	test('non-numeric year', () => {
		const r = parseVacancyCsv(mk('twenty,1,35620,5.2'));
		expect(r.ok).toBe(false);
		expect(r.errors[0].message).toMatch(/year must be/);
	});
	test('percentage over 100', () => {
		const r = parseVacancyCsv(mk('2024,1,35620,150'));
		expect(r.ok).toBe(false);
		expect(r.errors[0].message).toMatch(/0\.\.100/);
	});
	test('negative percentage', () => {
		const r = parseVacancyCsv(mk('2024,1,35620,-0.5'));
		expect(r.ok).toBe(false);
	});
	test('empty file', () => {
		const r = parseVacancyCsv('');
		expect(r.ok).toBe(false);
		expect(r.errors[0].message).toMatch(/empty/i);
	});
	test('binary detection', () => {
		const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x00, 0x00, 0x00]);
		const r = parseVacancyCsv(bytes);
		expect(r.ok).toBe(false);
		expect(r.errors[0].message).toMatch(/binary/i);
	});
});

describe('parseVacancyCsv — warnings (still valid)', () => {
	test('future quarter emits warning but passes', () => {
		const nextYear = new Date().getUTCFullYear() + 1;
		const r = parseVacancyCsv(mk(`${nextYear},1,35620,5.2`));
		expect(r.ok).toBe(true);
		expect(r.validRows.length).toBe(1);
		expect(r.warnings[0].message).toMatch(/future/);
	});
	test('intra-file duplicate PK: later row wins + warning', () => {
		const r = parseVacancyCsv(mk('2024,1,35620,5.2', '2024,1,35620,7.7'));
		expect(r.ok).toBe(true);
		expect(r.validRows.length).toBe(1);
		expect(r.validRows[0].rentalVacancyPct).toBe(7.7);
		expect(r.warnings[0].message).toMatch(/duplicate/);
	});
});

describe('helpers', () => {
	test('stripBom only strips the BOM', () => {
		expect(stripBom('\uFEFFhello')).toBe('hello');
		expect(stripBom('hello')).toBe('hello');
	});
	test('isLikelyBinary catches NUL in first 1KB', () => {
		expect(isLikelyBinary(new Uint8Array([65, 66, 0, 67]))).toBe(true);
		expect(isLikelyBinary(new Uint8Array([65, 66, 67]))).toBe(false);
	});
});
