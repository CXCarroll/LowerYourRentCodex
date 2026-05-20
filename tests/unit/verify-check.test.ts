import { beforeEach, describe, expect, mock, test } from 'bun:test';

let verifyResult: { ok: true } | { ok: false; reason: 'bad_code' } = { ok: true };
const verifyCode = mock(async () => verifyResult);
const verifyAddressExists = mock(async () => true);
const geocodeAddressToZip = mock(async () => '11201');
const lookupZip = mock(
	async (
		zip: string
	): Promise<{ zip: string; countyFips: string | null; cbsaCode: string | null } | null> => ({
		zip,
		countyFips: '36047',
		cbsaCode: '35620'
	})
);
const isRecentDuplicate = mock(async () => false);
const insertSubmission = mock(async () => {});
const buildNegotiationEmail = mock(async () => ({
	versions: [{ body: 'Generated email', reductionCents: 10_000 }]
}));

mock.module('$lib/server/rate-limit', () => ({
	consumeRateLimit: async () => ({ ok: true, retryAfterSec: 0 }),
	getClientIp: () => '127.0.0.1'
}));
mock.module('$lib/server/email-verification', () => ({ verifyCode }));
mock.module('$lib/server/mapbox', () => ({ verifyAddressExists }));
mock.module('$lib/server/geocode', () => ({ geocodeAddressToZip }));
mock.module('$lib/server/geo', () => ({ lookupZip }));
mock.module('$lib/server/submissions', () => ({ insertSubmission, isRecentDuplicate }));
mock.module('$lib/server/negotiation-email', () => ({ buildNegotiationEmail }));
mock.module('$lib/server/env', () => ({ env: { MAPBOX_TOKEN: undefined } }));

const { POST } = await import('../../src/routes/api/verify/check/+server');

function request(body: Record<string, unknown>) {
	return new Request('http://localhost/api/verify/check', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

async function post(body: Record<string, unknown>) {
	return POST({ request: request(body), fetch } as Parameters<typeof POST>[0]);
}

function validPayload(overrides: Record<string, unknown> = {}) {
	return {
		email: 'tenant@example.com',
		code: '123456',
		address: '123 Main St Apt 4B, Brooklyn, NY 11201',
		aptType: '1br',
		rentCents: 250_000,
		leaseExpiry: '2099-01-01',
		...overrides
	};
}

beforeEach(() => {
	verifyResult = { ok: true };
	verifyCode.mockClear();
	verifyAddressExists.mockClear();
	geocodeAddressToZip.mockClear();
	lookupZip.mockClear();
	isRecentDuplicate.mockClear();
	insertSubmission.mockClear();
	buildNegotiationEmail.mockClear();
});

describe('/api/verify/check', () => {
	test('rejects invalid submission fields before consuming the code', async () => {
		const res = await post(validPayload({ aptType: 'penthouse', rentCents: undefined }));
		const body = await res.json();

		expect(res.status).toBe(422);
		expect(body.error).toBe('invalid_submission');
		expect(body.issues.map((issue: { path: string }) => issue.path)).toContain('aptType');
		expect(verifyCode).not.toHaveBeenCalled();
		expect(insertSubmission).not.toHaveBeenCalled();
		expect(buildNegotiationEmail).not.toHaveBeenCalled();
	});

	test('persists a validated submission before generating the email', async () => {
		const res = await post(validPayload());
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.versions).toHaveLength(1);
		expect(verifyCode).toHaveBeenCalledWith('tenant@example.com', '123456');
		expect(isRecentDuplicate).toHaveBeenCalledWith(expect.any(String), '1br');
		expect(insertSubmission).toHaveBeenCalledWith(
			expect.objectContaining({
				buildingAddress: expect.stringContaining('123 Main'),
				zip: '11201',
				countyFips: '36047',
				cbsaCode: '35620',
				aptType: '1br',
				rentCents: 250_000,
				leaseExpiry: '2099-01-01'
			})
		);
		expect(buildNegotiationEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				address: expect.stringContaining('123 Main'),
				aptType: '1br',
				rentCents: 250_000,
				zip: '11201'
			}),
			expect.any(Function)
		);
	});

	test('skips insert for recent duplicates but still generates the email', async () => {
		isRecentDuplicate.mockImplementationOnce(async () => true);

		const res = await post(validPayload());

		expect(res.status).toBe(200);
		expect(insertSubmission).not.toHaveBeenCalled();
		expect(buildNegotiationEmail).toHaveBeenCalled();
	});

	test('rejects addresses without a supported ZIP after code verification', async () => {
		lookupZip.mockImplementationOnce(async () => null);

		const res = await post(validPayload());
		const body = await res.json();

		expect(res.status).toBe(422);
		expect(body.error).toBe('unsupported_zip');
		expect(verifyCode).toHaveBeenCalled();
		expect(insertSubmission).not.toHaveBeenCalled();
		expect(buildNegotiationEmail).not.toHaveBeenCalled();
	});
});
