import { describe, expect, test } from 'bun:test';
import { parseAcsRentCsv } from '../../src/lib/server/admin/acs-csv';

const HEADER = 'year,geo_level,geo_id,median_gross_rent_cents,sample_size\n';

describe('parseAcsRentCsv', () => {
	test('accepts a minimal valid ZCTA file', () => {
		const csv = HEADER + '2024,zcta,11201,290000,12500\n';
		const r = parseAcsRentCsv(csv);
		expect(r.ok).toBe(true);
		expect(r.errors).toHaveLength(0);
		expect(r.validRows).toEqual([
			{
				year: 2024,
				geoLevel: 'zcta',
				geoId: '11201',
				medianGrossRentCents: 290000,
				sampleSize: 12500
			}
		]);
	});

	test('accepts a valid PUMA recent-mover file', () => {
		const csv = HEADER + '2024,puma,1200500,245000,86\n';
		const r = parseAcsRentCsv(csv);
		expect(r.ok).toBe(true);
		expect(r.validRows).toEqual([
			{
				year: 2024,
				geoLevel: 'puma',
				geoId: '1200500',
				medianGrossRentCents: 245000,
				sampleSize: 86
			}
		]);
	});

	test('strips BOM and zero-pads short ZCTA ids', () => {
		const r = parseAcsRentCsv('\uFEFF' + HEADER + '2024,zcta,9021,250000,\n');
		expect(r.ok).toBe(true);
		expect(r.validRows[0].geoId).toBe('09021');
		expect(r.validRows[0].sampleSize).toBeNull();
	});

	test('rejects bad headers', () => {
		const r = parseAcsRentCsv('year,geo_id,median_gross_rent_cents\n2024,11201,290000\n');
		expect(r.ok).toBe(false);
		expect(r.errors[0].message).toMatch(/Header/);
		expect(r.errors[0].message).toMatch(/missing/);
	});

	test('rejects unknown geo levels', () => {
		const r = parseAcsRentCsv(HEADER + '2024,county,36047,290000,12500\n');
		expect(r.ok).toBe(false);
		expect(r.errors[0].message).toMatch(/geo_level/);
	});

	test('rejects invalid ZCTA ids', () => {
		const r = parseAcsRentCsv(HEADER + '2024,zcta,abc,290000,12500\n');
		expect(r.ok).toBe(false);
		expect(r.errors[0].message).toMatch(/geo_id/);
	});

	test('rejects invalid PUMA ids', () => {
		const r = parseAcsRentCsv(HEADER + '2024,puma,00500,290000,12500\n');
		expect(r.ok).toBe(false);
		expect(r.errors[0].message).toMatch(/geo_id/);
	});

	test('rejects missing or Census sentinel median rent values', () => {
		const missing = parseAcsRentCsv(HEADER + '2024,zcta,11201,,12500\n');
		const sentinel = parseAcsRentCsv(HEADER + '2024,zcta,11201,-666666666,12500\n');
		expect(missing.ok).toBe(false);
		expect(sentinel.ok).toBe(false);
		expect(missing.errors[0].message).toMatch(/median_gross_rent_cents/);
		expect(sentinel.errors[0].message).toMatch(/median_gross_rent_cents/);
	});

	test('rejects invalid sample size', () => {
		const r = parseAcsRentCsv(HEADER + '2024,zcta,11201,290000,-1\n');
		expect(r.ok).toBe(false);
		expect(r.errors[0].message).toMatch(/sample_size/);
	});

	test('intra-file duplicate PK warns and later row wins', () => {
		const csv = HEADER + '2024,zcta,11201,290000,12500\n2024,zcta,11201,300000,13000\n';
		const r = parseAcsRentCsv(csv);
		expect(r.ok).toBe(true);
		expect(r.validRows).toHaveLength(1);
		expect(r.validRows[0].medianGrossRentCents).toBe(300000);
		expect(r.warnings).toHaveLength(1);
	});

	test('rejects oversized row counts', () => {
		const rows = Array.from({ length: 50_001 }, (_, i) => `2024,zcta,${String(i).padStart(5, '0')},200000,100`);
		const r = parseAcsRentCsv(HEADER + rows.join('\n') + '\n');
		expect(r.ok).toBe(false);
		expect(r.errors[0].message).toMatch(/Too many rows/);
	});

	test('rejects binary files', () => {
		const r = parseAcsRentCsv(new Uint8Array([0, 1, 2, 3]));
		expect(r.ok).toBe(false);
		expect(r.errors[0].message).toMatch(/binary/);
	});
});
