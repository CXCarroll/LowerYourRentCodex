import { describe, expect, test } from 'bun:test';
import { geocodeAddress } from '../../src/lib/server/geocode';

describe('geocodeAddress', () => {
	test('extracts ZIP and PUMA from Census geographies response', async () => {
		const fetchFn = async () =>
			new Response(
				JSON.stringify({
					result: {
						addressMatches: [
							{
								addressComponents: { zip: '11201' },
								geographies: {
									'2020 Public Use Microdata Areas': [
										{ STATE: '36', PUMA: '04001', GEOID: '3604001' }
									]
								}
							}
						]
					}
				})
			);

		const result = await geocodeAddress(
			'123 Main St Brooklyn NY 11201',
			fetchFn as unknown as typeof fetch
		);

		expect(result).toEqual({ zip: '11201', pumaGeoId: '3604001' });
	});

	test('falls back to STATE plus PUMA when GEOID is absent', async () => {
		const fetchFn = async () =>
			new Response(
				JSON.stringify({
					result: {
						addressMatches: [
							{
								addressComponents: { zip: '33131' },
								geographies: {
									'Public Use Microdata Areas': [{ STATEFP: '12', PUMA5CE: '00500' }]
								}
							}
						]
					}
				})
			);

		const result = await geocodeAddress(
			'1 Brickell Ave Miami FL 33131',
			fetchFn as unknown as typeof fetch
		);

		expect(result).toEqual({ zip: '33131', pumaGeoId: '1200500' });
	});
});
