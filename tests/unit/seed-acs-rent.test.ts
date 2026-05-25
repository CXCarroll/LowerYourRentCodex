import { describe, expect, test } from 'bun:test';
import {
	buildAcsUrl,
	fetchAndParseAcsYear,
	getAcsSeedConfig,
	parseAcsApiResponse,
	redactedUrl,
	validateAcsApiResponse
} from '../../scripts/seed-acs-rent-lib';

const VALID_RESPONSE = JSON.stringify([
	['B25064_001E', 'B25001_001E', 'zip code tabulation area'],
	['2900', '12500', '11201'],
	['-666666666', '100', '11203'],
	['2100', '-1', '09021']
]);

describe('seed-acs-rent helpers', () => {
	test('parses valid Census JSON into nationwide ZCTA rows and skips rent sentinels', () => {
		const result = parseAcsApiResponse(VALID_RESPONSE, 2024);
		expect(result.rows).toEqual([
			{
				year: 2024,
				geoLevel: 'zcta',
				geoId: '11201',
				medianGrossRentCents: 290000,
				sampleSize: 12500
			},
			{
				year: 2024,
				geoLevel: 'zcta',
				geoId: '09021',
				medianGrossRentCents: 210000,
				sampleSize: null
			}
		]);
		expect(result.skippedInvalidRentRows).toBe(1);
		expect(result.skippedInvalidGeoRows).toBe(0);
	});

	test('rejects malformed JSON', () => {
		expect(() => validateAcsApiResponse('{nope')).toThrow(/not valid JSON/);
	});

	test('rejects Census error payloads', () => {
		expect(() => validateAcsApiResponse(JSON.stringify({ error: 'invalid key' }))).toThrow(
			/Census API error/
		);
	});

	test('rejects missing required columns', () => {
		const response = JSON.stringify([['B25064_001E', 'NAME'], ['2900', 'ZCTA5 11201']]);
		expect(() => validateAcsApiResponse(response)).toThrow(/missing required columns/);
	});

	test('requires CENSUS_API_KEY when ACS_REQUIRE_API_KEY=true', () => {
		expect(() => getAcsSeedConfig({ ACS_REQUIRE_API_KEY: 'true' })).toThrow(/CENSUS_API_KEY/);
		expect(
			getAcsSeedConfig({ ACS_REQUIRE_API_KEY: 'true', CENSUS_API_KEY: 'abc' }).apiKey
		).toBe('abc');
	});

	test('honors ACS_YEAR as a single targeted year', () => {
		expect(getAcsSeedConfig({ ACS_YEAR: '2024' }).yearsToTry).toEqual([2024]);
	});

	test('builds API URLs with key but redacts key from display URL', () => {
		const url = buildAcsUrl(2024, 'secret-key');
		expect(url).toContain('key=secret-key');
		expect(url).toContain('for=zip+code+tabulation+area%3A*');
		const display = redactedUrl(url);
		expect(display).not.toContain('secret-key');
		expect(display).toContain('key=');
	});

	test('mock fetch appends API key, exposes only redacted log URL, and transforms rows', async () => {
		let capturedUrl = '';
		let capturedLogUrl = '';
		let validateCalled = false;
		const result = await fetchAndParseAcsYear(2024, 'secret-key', async (url, logUrl, validate) => {
			capturedUrl = url;
			capturedLogUrl = logUrl;
			validate(VALID_RESPONSE);
			validateCalled = true;
			return VALID_RESPONSE;
		});

		expect(capturedUrl).toContain('key=secret-key');
		expect(capturedUrl).toContain('zip+code+tabulation+area%3A*');
		expect(capturedLogUrl).not.toContain('secret-key');
		expect(validateCalled).toBe(true);
		expect(result.rows.map((r) => r.geoId)).toEqual(['11201', '09021']);
	});
});
