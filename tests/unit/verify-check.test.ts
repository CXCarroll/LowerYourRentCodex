import { beforeEach, describe, expect, mock, test } from 'bun:test';

type VerifyResult =
	| { ok: true }
	| {
			ok: false;
			reason: 'not_found' | 'expired' | 'too_many_attempts' | 'bad_code' | 'unavailable';
	  };

let verifyResult: VerifyResult = { ok: true };
const callOrder: string[] = [];

const tx = {};
const transaction = mock(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx));
const consumeVerifiedCodeTx = mock(async () => {
	callOrder.push('consume');
	return verifyResult;
});
const verifyAddressExists = mock(async () => true);
const geocodeAddressToZip = mock(async (): Promise<string | null> => '11201');
const lookupZip = mock(
	async (
		zip: string
	): Promise<{ zip: string; countyFips: string | null; cbsaCode: string | null } | null> => ({
		zip,
		countyFips: '36047',
		cbsaCode: '35620'
	})
);
const insertSubmissionUnlessRecentDuplicateTx = mock(async () => {
	callOrder.push('insert');
	return { inserted: true };
});
const buildNegotiationEmail = mock(async () => {
	callOrder.push('build');
	return { versions: [{ body: 'Generated email', reductionCents: 10_000 }] };
});

mock.module('$lib/server/db/client', () => ({ db: { transaction } }));
mock.module('$lib/server/rate-limit', () => ({
	consumeRateLimit: async () => ({ ok: true, retryAfterSec: 0 }),
	getClientIp: () => '127.0.0.1'
}));
mock.module('$lib/server/email-verification', () => ({ consumeVerifiedCodeTx }));
mock.module('$lib/server/mapbox', () => ({ verifyAddressExists }));
mock.module('$lib/server/geocode', () => ({ geocodeAddressToZip }));
mock.module('$lib/server/geo', () => ({ lookupZip }));
mock.module('$lib/server/submissions', () => ({ insertSubmissionUnlessRecentDuplicateTx }));
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
	callOrder.length = 0;
	transaction.mockClear();
	consumeVerifiedCodeTx.mockClear();
	verifyAddressExists.mockClear();
	geocodeAddressToZip.mockClear();
	lookupZip.mockClear();
	insertSubmissionUnlessRecentDuplicateTx.mockClear();
	buildNegotiationEmail.mockClear();
});

describe('/api/verify/check', () => {
	test('rejects invalid submission fields before consuming the code', async () => {
		const res = await post(validPayload({ aptType: 'penthouse', rentCents: undefined }));
		const body = await res.json();

		expect(res.status).toBe(422);
		expect(body.error).toBe('invalid_submission');
		expect(body.issues.map((issue: { path: string }) => issue.path)).toContain('aptType');
		expect(consumeVerifiedCodeTx).not.toHaveBeenCalled();
		expect(insertSubmissionUnlessRecentDuplicateTx).not.toHaveBeenCalled();
		expect(buildNegotiationEmail).not.toHaveBeenCalled();
	});

	test('rejects unknown addresses before consuming the code', async () => {
		verifyAddressExists.mockImplementationOnce(async () => false);

		const res = await post(validPayload());
		const body = await res.json();

		expect(res.status).toBe(422);
		expect(body.error).toBe('address_not_found');
		expect(consumeVerifiedCodeTx).not.toHaveBeenCalled();
		expect(buildNegotiationEmail).not.toHaveBeenCalled();
	});

	test('rejects unresolved ZIPs before consuming the code', async () => {
		geocodeAddressToZip.mockImplementationOnce(async () => null);

		const res = await post(validPayload({ address: '123 Main St Apt 4B, Brooklyn, NY' }));
		const body = await res.json();

		expect(res.status).toBe(422);
		expect(body.error).toBe('missing_zip');
		expect(consumeVerifiedCodeTx).not.toHaveBeenCalled();
		expect(buildNegotiationEmail).not.toHaveBeenCalled();
	});

	test('rejects unsupported ZIPs before consuming the code', async () => {
		lookupZip.mockImplementationOnce(async () => null);

		const res = await post(validPayload());
		const body = await res.json();

		expect(res.status).toBe(422);
		expect(body.error).toBe('unsupported_zip');
		expect(consumeVerifiedCodeTx).not.toHaveBeenCalled();
		expect(insertSubmissionUnlessRecentDuplicateTx).not.toHaveBeenCalled();
		expect(buildNegotiationEmail).not.toHaveBeenCalled();
	});

	test('returns unavailable when ZIP lookup fails before consuming the code', async () => {
		lookupZip.mockImplementationOnce(async () => {
			throw new Error('db unavailable');
		});

		const res = await post(validPayload());
		const body = await res.json();

		expect(res.status).toBe(503);
		expect(body.error).toBe('submission_unavailable');
		expect(consumeVerifiedCodeTx).not.toHaveBeenCalled();
		expect(buildNegotiationEmail).not.toHaveBeenCalled();
	});

	test('returns unavailable when email generation fails before consuming the code', async () => {
		buildNegotiationEmail.mockImplementationOnce(async () => {
			throw new Error('template failure');
		});

		const res = await post(validPayload());
		const body = await res.json();

		expect(res.status).toBe(503);
		expect(body.error).toBe('email_generation_unavailable');
		expect(consumeVerifiedCodeTx).not.toHaveBeenCalled();
		expect(insertSubmissionUnlessRecentDuplicateTx).not.toHaveBeenCalled();
	});

	test('builds the email before consuming the code and persisting the submission', async () => {
		const res = await post(validPayload());
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.versions).toHaveLength(1);
		expect(callOrder).toEqual(['build', 'consume', 'insert']);
		expect(consumeVerifiedCodeTx).toHaveBeenCalledWith(tx, 'tenant@example.com', '123456');
		expect(insertSubmissionUnlessRecentDuplicateTx).toHaveBeenCalledWith(
			tx,
			expect.objectContaining({
				buildingAddress: expect.stringContaining('123 Main'),
				unitHash: expect.any(String),
				zip: '11201',
				countyFips: '36047',
				cbsaCode: '35620',
				aptType: '1br',
				rentCents: 250_000,
				leaseExpiry: '2099-01-01'
			})
		);
	});

	test('consumes duplicate submissions but lets the transaction helper skip insert', async () => {
		insertSubmissionUnlessRecentDuplicateTx.mockImplementationOnce(async () => {
			callOrder.push('insert');
			return { inserted: false };
		});

		const res = await post(validPayload());

		expect(res.status).toBe(200);
		expect(consumeVerifiedCodeTx).toHaveBeenCalled();
		expect(insertSubmissionUnlessRecentDuplicateTx).toHaveBeenCalled();
		expect(buildNegotiationEmail).toHaveBeenCalled();
	});

	test('returns unavailable without generated versions when the final transaction fails', async () => {
		transaction.mockImplementationOnce(async () => {
			throw new Error('write failed');
		});

		const res = await post(validPayload());
		const body = await res.json();

		expect(res.status).toBe(503);
		expect(body).toEqual({ versions: [], error: 'submission_unavailable' });
	});

	test.each([
		['bad_code', 401],
		['expired', 410],
		['not_found', 410],
		['too_many_attempts', 429],
		['unavailable', 503]
	] as const)('preserves %s verification failure status', async (reason, status) => {
		verifyResult = { ok: false, reason };

		const res = await post(validPayload());
		const body = await res.json();

		expect(res.status).toBe(status);
		expect(body.error).toBe(reason);
		expect(insertSubmissionUnlessRecentDuplicateTx).not.toHaveBeenCalled();
	});
});
