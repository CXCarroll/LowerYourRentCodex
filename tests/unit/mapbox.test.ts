import { describe, expect, test } from 'bun:test';
import {
	featureToMatch,
	suggestMapboxAddresses,
	verifyAddressExists
} from '../../src/lib/server/mapbox';

const TOKEN = 'pk.test-token';

/** A fetch stub that resolves to a JSON Response with the given status. */
function jsonFetch(status: number, body: unknown): typeof fetch {
	return (async () =>
		new Response(JSON.stringify(body), {
			status,
			headers: { 'Content-Type': 'application/json' }
		})) as unknown as typeof fetch;
}

/** A fetch stub that rejects, simulating a transport error / timeout. */
const throwingFetch = (async () => {
	throw new Error('network down');
}) as unknown as typeof fetch;

describe('featureToMatch', () => {
	test('maps full_address and a 5-digit ZIP', () => {
		const m = featureToMatch({
			properties: {
				full_address: '123 Main Street, Brooklyn, New York 11201, United States',
				context: { postcode: { name: '11201' } }
			}
		});
		expect(m).toEqual({
			display: '123 Main Street, Brooklyn, New York 11201, United States',
			zip: '11201'
		});
	});

	test('falls back to name + place_formatted when full_address is absent', () => {
		const m = featureToMatch({
			properties: {
				name: '500 Market St',
				place_formatted: 'San Francisco, California 94105, United States'
			}
		});
		expect(m?.display).toBe('500 Market St, San Francisco, California 94105, United States');
	});

	test('returns null when the feature has no properties', () => {
		expect(featureToMatch({})).toBeNull();
	});

	test('zip is null when the postcode is not 5 digits', () => {
		const m = featureToMatch({
			properties: { full_address: '1 A St, Anytown', context: { postcode: { name: '1201' } } }
		});
		expect(m?.zip).toBeNull();
	});

	test('zip is null when no postcode is present', () => {
		const m = featureToMatch({ properties: { full_address: '1 A St, Anytown' } });
		expect(m?.zip).toBeNull();
	});
});

describe('suggestMapboxAddresses', () => {
	test('returns [] when no token is configured', async () => {
		const out = await suggestMapboxAddresses('123 Main St', undefined, jsonFetch(200, {}));
		expect(out).toEqual([]);
	});

	test('returns [] when the query is too short', async () => {
		const out = await suggestMapboxAddresses('12', TOKEN, jsonFetch(200, {}));
		expect(out).toEqual([]);
	});

	test('maps features from a 200 response', async () => {
		const out = await suggestMapboxAddresses('123 Main', TOKEN, jsonFetch(200, {
			features: [
				{
					properties: {
						full_address: '123 Main St, Brooklyn, New York 11201, United States',
						context: { postcode: { name: '11201' } }
					}
				},
				{
					properties: {
						full_address: '123 Main Ave, Queens, New York 11375, United States',
						context: { postcode: { name: '11375' } }
					}
				}
			]
		}));
		expect(out).toHaveLength(2);
		expect(out[0].zip).toBe('11201');
		expect(out[1].display).toContain('Queens');
	});

	test('returns [] on a non-OK response', async () => {
		const out = await suggestMapboxAddresses('123 Main St', TOKEN, jsonFetch(401, {}));
		expect(out).toEqual([]);
	});

	test('returns [] when the request throws', async () => {
		const out = await suggestMapboxAddresses('123 Main St', TOKEN, throwingFetch);
		expect(out).toEqual([]);
	});
});

describe('verifyAddressExists', () => {
	test('returns true when no token is configured (verification disabled)', async () => {
		expect(await verifyAddressExists('zzz qqq', undefined, jsonFetch(200, { features: [] }))).toBe(
			true
		);
	});

	test('returns false when the query is too short', async () => {
		expect(await verifyAddressExists('12', TOKEN, jsonFetch(200, {}))).toBe(false);
	});

	test('returns true when Mapbox finds at least one match', async () => {
		const ok = await verifyAddressExists('123 Main St, Brooklyn NY', TOKEN, jsonFetch(200, {
			features: [{ properties: { full_address: '123 Main St, Brooklyn, NY' } }]
		}));
		expect(ok).toBe(true);
	});

	test('returns false when Mapbox returns zero matches', async () => {
		expect(await verifyAddressExists('zzzz qqqq wwww', TOKEN, jsonFetch(200, { features: [] }))).toBe(
			false
		);
	});

	test('fails open (true) on a non-OK response', async () => {
		expect(await verifyAddressExists('123 Main St', TOKEN, jsonFetch(503, {}))).toBe(true);
	});

	test('fails open (true) when the request throws', async () => {
		expect(await verifyAddressExists('123 Main St', TOKEN, throwingFetch)).toBe(true);
	});
});
