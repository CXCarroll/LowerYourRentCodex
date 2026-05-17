import { describe, expect, test } from 'bun:test';
import { toCountyFmrCsv, toSafmrCsv, toVacancyCsv } from '../../src/lib/server/admin/hud-csv';
import { parseFmrCsv } from '../../src/lib/server/admin/fmr-csv';
import { parseVacancyCsv } from '../../src/lib/server/admin/vacancy-csv';
import type { HudFmrRow, HudSafmrRow } from '../../src/lib/server/admin/hud-files';
import type { HvsVacancyRow } from '../../src/lib/server/admin/census-hvs';

describe('toCountyFmrCsv', () => {
	test('emits header-only CSV for empty input', () => {
		expect(toCountyFmrCsv([])).toBe('year,county_fips,apt_type,fmr_cents\n');
	});

	test('round-trips through parseFmrCsv', () => {
		const rows: HudFmrRow[] = [
			{ year: 2025, countyFips: '36047', aptType: 'studio', fmrCents: 238600 },
			{ year: 2025, countyFips: '36047', aptType: '1br', fmrCents: 245100 },
			{ year: 2025, countyFips: '06037', aptType: '2br', fmrCents: 249800 }
		];
		const csv = toCountyFmrCsv(rows);
		const parsed = parseFmrCsv(csv);
		expect(parsed.ok).toBe(true);
		expect(parsed.errors).toHaveLength(0);
		expect(parsed.validRows).toEqual(rows);
	});
});

describe('toSafmrCsv', () => {
	test('emits header-only CSV for empty input', () => {
		expect(toSafmrCsv([])).toBe('year,cbsa_code,zip,apt_type,fmr_cents\n');
	});

	test('serializes rows in order', () => {
		const rows: HudSafmrRow[] = [
			{ year: 2025, cbsaCode: '35620', zip: '11201', aptType: '1br', fmrCents: 245100 },
			{ year: 2025, cbsaCode: '35620', zip: '10001', aptType: '2br', fmrCents: 312000 }
		];
		const csv = toSafmrCsv(rows);
		const lines = csv.trim().split('\n');
		expect(lines[0]).toBe('year,cbsa_code,zip,apt_type,fmr_cents');
		expect(lines[1]).toBe('2025,35620,11201,1br,245100');
		expect(lines[2]).toBe('2025,35620,10001,2br,312000');
	});

	test('escapes embedded commas and quotes', () => {
		const rows: HudSafmrRow[] = [
			{ year: 2025, cbsaCode: 'a,b', zip: '10001', aptType: '1br', fmrCents: 100000 }
		];
		expect(toSafmrCsv(rows)).toContain('"a,b"');
	});
});

describe('toVacancyCsv', () => {
	test('emits header-only CSV for empty input', () => {
		expect(toVacancyCsv([])).toBe('year,quarter,cbsa_code,rental_vacancy_pct\n');
	});

	test('round-trips through parseVacancyCsv', () => {
		const rows: HvsVacancyRow[] = [
			{ year: 2025, quarter: 4, cbsaCode: '35620', rentalVacancyPct: 6.2 },
			{ year: 2025, quarter: 3, cbsaCode: '31080', rentalVacancyPct: 5.1 }
		];
		const csv = toVacancyCsv(rows);
		const parsed = parseVacancyCsv(csv);
		expect(parsed.ok).toBe(true);
		expect(parsed.errors).toHaveLength(0);
		expect(parsed.validRows).toEqual([
			{ year: 2025, quarter: 4, cbsaCode: '35620', rentalVacancyPct: 6.2 },
			{ year: 2025, quarter: 3, cbsaCode: '31080', rentalVacancyPct: 5.1 }
		]);
	});

	test('formats percent to two decimals', () => {
		const csv = toVacancyCsv([
			{ year: 2025, quarter: 1, cbsaCode: '12060', rentalVacancyPct: 8 }
		]);
		expect(csv).toContain('8.00');
	});
});
