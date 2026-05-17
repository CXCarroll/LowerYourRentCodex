import { describe, expect, test } from 'bun:test';
import { parseFmrCsv } from '../../src/lib/server/admin/fmr-csv';

const HEADER = 'year,county_fips,apt_type,fmr_cents\n';

describe('parseFmrCsv', () => {
	test('accepts a minimal valid file', () => {
		const csv = HEADER + '2024,36047,1br,200000\n';
		const r = parseFmrCsv(csv);
		expect(r.ok).toBe(true);
		expect(r.errors).toHaveLength(0);
		expect(r.validRows).toEqual([
			{ year: 2024, countyFips: '36047', aptType: '1br', fmrCents: 200000 }
		]);
	});

	test('zero-pads short county_fips', () => {
		const csv = HEADER + '2024,6037,1br,200000\n';
		const r = parseFmrCsv(csv);
		expect(r.validRows[0].countyFips).toBe('06037');
	});

	test('rejects invalid apt_type', () => {
		const csv = HEADER + '2024,36047,5br,200000\n';
		const r = parseFmrCsv(csv);
		expect(r.ok).toBe(false);
		expect(r.errors[0].message).toMatch(/apt_type/);
	});

	test('rejects bad year', () => {
		const csv = HEADER + '1999,36047,1br,200000\n';
		const r = parseFmrCsv(csv);
		expect(r.ok).toBe(false);
		expect(r.errors[0].message).toMatch(/year/);
	});

	test('accepts fmr_dollars header (converts to cents)', () => {
		const csv = 'year,county_fips,apt_type,fmr_dollars\n2024,36047,studio,1800\n';
		const r = parseFmrCsv(csv);
		expect(r.ok).toBe(true);
		expect(r.validRows[0].fmrCents).toBe(180000);
	});

	test('strips $ and commas in amount', () => {
		const csv = 'year,county_fips,apt_type,fmr_dollars\n2024,36047,2br,"$2,500"\n';
		const r = parseFmrCsv(csv);
		expect(r.ok).toBe(true);
		expect(r.validRows[0].fmrCents).toBe(250000);
	});

	test('warns on future years but still accepts', () => {
		const nextYear = new Date().getUTCFullYear() + 1;
		const csv = HEADER + `${nextYear},36047,1br,200000\n`;
		const r = parseFmrCsv(csv);
		expect(r.ok).toBe(true);
		expect(r.warnings).toHaveLength(1);
	});

	test('intra-file duplicate PK → warning, later row wins', () => {
		const csv = HEADER + '2024,36047,1br,200000\n2024,36047,1br,210000\n';
		const r = parseFmrCsv(csv);
		expect(r.validRows).toHaveLength(1);
		expect(r.validRows[0].fmrCents).toBe(210000);
		expect(r.warnings).toHaveLength(1);
	});

	test('rejects unknown extra columns', () => {
		const csv = 'year,county_fips,apt_type,fmr_cents,nonsense\n2024,36047,1br,200000,xyz\n';
		const r = parseFmrCsv(csv);
		expect(r.ok).toBe(false);
		expect(r.errors[0].message).toMatch(/unknown/);
	});

	test('out-of-range fmr_cents is rejected', () => {
		const csv = HEADER + '2024,36047,1br,50\n';
		const r = parseFmrCsv(csv);
		expect(r.ok).toBe(false);
		expect(r.errors[0].message).toMatch(/out of range/);
	});

	test('rejects binary files', () => {
		const buf = new Uint8Array([0, 1, 2, 3, 0, 0, 5]);
		const r = parseFmrCsv(buf);
		expect(r.ok).toBe(false);
		expect(r.errors[0].message).toMatch(/binary/);
	});
});
