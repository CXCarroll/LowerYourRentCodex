import { describe, expect, mock, test } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: process.env }));
mock.module('$env/dynamic/public', () => ({ env: process.env }));
mock.module('$app/environment', () => ({ building: false }));

const { acsRentDescriptionForSource, buildNegotiationEmail } = await import(
	'../../src/lib/server/negotiation-email'
);

describe('buildNegotiationEmail', () => {
	test('renders from validated rent cents instead of parsing raw rent fallbacks', async () => {
		const { versions } = await buildNegotiationEmail(
			{
				address: '123 Main St Brooklyn NY 11201',
				aptType: '1br',
				rentCents: 310_000,
				zip: '11201'
			},
			fetch
		);

		expect(versions[0].body).toContain('$3,100');
		expect(versions[0].body).not.toContain('$2,500');
	});

	test('labels PUMS recent-mover ACS distinctly from aggregate ZIP ACS', () => {
		expect(acsRentDescriptionForSource('pums_recent_mover')).toContain(
			'ACS recent-mover market rent'
		);
		expect(acsRentDescriptionForSource('acs_aggregate')).toBe(
			'ACS median gross rent for this ZIP'
		);
		expect(acsRentDescriptionForSource(null)).toBe('ACS median gross rent for this ZIP');
	});
});
