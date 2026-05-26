// Step 2 of the negotiate flow: the user submits the 6-digit code along with
// the form data they already hold (the flow is stateless — no server session
// for an anonymous user). On a valid code we generate and return the
// negotiation-email variations as `{ versions: [{ body, reductionCents }] }`.

import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { consumeRateLimit, getClientIp } from '$lib/server/rate-limit';
import { emailSchema, submissionSchema, verificationCodeSchema } from '$lib/shared/validation';
import { consumeVerifiedCodeTx, type VerifyCodeResult } from '$lib/server/email-verification';
import { verifyAddressExists } from '$lib/server/mapbox';
import { buildNegotiationEmail } from '$lib/server/negotiation-email';
import { env } from '$lib/server/env';
import { normalizeBuildingAddress } from '$lib/server/address';
import { geocodeAddress } from '$lib/server/geocode';
import { lookupZip } from '$lib/server/geo';
import { insertSubmissionUnlessRecentDuplicateTx } from '$lib/server/submissions';
import { db } from '$lib/server/db/client';

const noStore = { 'Cache-Control': 'no-store' };
const route = '/api/verify/check';

type TimingName =
	| 'rate_limit'
	| 'payload_validation'
	| 'address_verification'
	| 'geocode'
	| 'zip_lookup'
	| 'negotiation_email_generation'
	| 'otp_transaction'
	| 'response_serialization';

interface TimingEntry {
	name: TimingName;
	durationMs: number;
}

function roundTiming(ms: number): number {
	return Math.round(ms * 100) / 100;
}

function createRequestTimings() {
	const requestStart = performance.now();
	const entries: TimingEntry[] = [];

	function start(name: TimingName): () => void {
		const spanStart = performance.now();
		let ended = false;
		return () => {
			if (ended) return;
			ended = true;
			entries.push({ name, durationMs: performance.now() - spanStart });
		};
	}

	async function time<T>(name: TimingName, fn: () => Promise<T>): Promise<T> {
		const end = start(name);
		try {
			return await fn();
		} finally {
			end();
		}
	}

	function serverTiming(): string {
		return entries
			.map(({ name, durationMs }) => `${name};dur=${roundTiming(durationMs).toFixed(2)}`)
			.join(', ');
	}

		function log(response: Response, error?: unknown): void {
			const sampleRate = env.VERIFY_CHECK_TIMING_SAMPLE_RATE;
			if (response.status < 500 && (sampleRate <= 0 || Math.random() >= sampleRate)) return;

			const timingsMs = Object.fromEntries(
				entries.map(({ name, durationMs }) => [name, roundTiming(durationMs)])
			);

		console.info(
			JSON.stringify({
				event: 'verify_check_timing',
				route,
				method: 'POST',
				status: response.status,
				error: typeof error === 'string' ? error : undefined,
				timings_ms: timingsMs,
				total_ms: roundTiming(performance.now() - requestStart)
			})
		);
	}

	return { start, time, serverTiming, log };
}

function statusForVerifyResult(result: Exclude<VerifyCodeResult, { ok: true }>): number {
	if (result.reason === 'bad_code') return 401;
	if (result.reason === 'too_many_attempts') return 429;
	if (result.reason === 'unavailable') return 503;
	return 410; // expired | not_found
}

type VerifyCheckTx = Parameters<typeof consumeVerifiedCodeTx>[0];

interface VerifyCheckDb {
	transaction<T>(callback: (tx: VerifyCheckTx) => Promise<T>): Promise<T>;
}

interface VerifyCheckDeps {
	consumeRateLimit: typeof consumeRateLimit;
	getClientIp: typeof getClientIp;
	consumeVerifiedCodeTx: typeof consumeVerifiedCodeTx;
	verifyAddressExists: typeof verifyAddressExists;
	buildNegotiationEmail: typeof buildNegotiationEmail;
	normalizeBuildingAddress: typeof normalizeBuildingAddress;
	geocodeAddress: typeof geocodeAddress;
	lookupZip: typeof lookupZip;
	insertSubmissionUnlessRecentDuplicateTx: typeof insertSubmissionUnlessRecentDuplicateTx;
	db: VerifyCheckDb | null;
	getMapboxToken: () => string | undefined;
}

export function _createVerifyCheckPost(deps: VerifyCheckDeps): RequestHandler {
	return async (event) => {
	const { request, fetch } = event;
	const timings = createRequestTimings();

	function respond(
		body: Record<string, unknown>,
		init: Parameters<typeof json>[1] = {}
	): Response {
		const endSerialization = timings.start('response_serialization');
		const response = json(body, init);
		endSerialization();
		response.headers.set('Server-Timing', timings.serverTiming());
		timings.log(response, body.error);
		return response;
	}

	const ip = deps.getClientIp(event);
	const ipGate = await timings.time('rate_limit', () =>
		deps.consumeRateLimit({
			scope: 'otp_check_ip',
			key: ip,
			limit: 10,
			windowMs: 60_000
		})
	);
	if (!ipGate.ok) {
		return respond(
			{
				versions: [],
				error: ipGate.reason === 'unavailable' ? 'unavailable' : 'rate_limited'
			},
			{
				status: ipGate.reason === 'unavailable' ? 503 : 429,
				headers: {
					...noStore,
					...(ipGate.reason === 'unavailable'
						? {}
						: { 'Retry-After': String(ipGate.retryAfterSec) })
				}
			}
		);
	}

	let payload: {
		email?: unknown;
		code?: unknown;
		address?: unknown;
		aptType?: unknown;
		rentCents?: unknown;
		leaseExpiry?: unknown;
	};
	const endPayloadValidation = timings.start('payload_validation');
	try {
		payload = await request.json();
	} catch {
		endPayloadValidation();
		return respond({ versions: [], error: 'bad_request' }, { status: 400, headers: noStore });
	}

	const emailParsed = emailSchema.safeParse(payload.email);
	const codeParsed = verificationCodeSchema.safeParse(payload.code);
	if (!emailParsed.success || !codeParsed.success) {
		endPayloadValidation();
		return respond({ versions: [], error: 'invalid_input' }, { status: 422, headers: noStore });
	}

	const submissionParsed = submissionSchema.safeParse({
		address: payload.address,
		aptType: payload.aptType,
		rentCents: payload.rentCents,
		leaseExpiry: payload.leaseExpiry
	});
	if (!submissionParsed.success) {
		endPayloadValidation();
		return respond(
			{
				versions: [],
				error: 'invalid_submission',
				issues: submissionParsed.error.issues.map((issue) => ({
					path: issue.path.join('.'),
					message: issue.message
				}))
			},
			{ status: 422, headers: noStore }
		);
	}
	endPayloadValidation();
	const submission = submissionParsed.data;

	// Verify the address BEFORE the code so a bad address doesn't consume the
	// code or burn a verification attempt. Disabled when MAPBOX_TOKEN is unset.
	const addressOk = await timings.time('address_verification', () =>
		deps.verifyAddressExists(submission.address, deps.getMapboxToken(), fetch)
	);
	if (!addressOk) {
		return respond(
			{ versions: [], error: 'address_not_found' },
			{ status: 422, headers: noStore }
		);
	}

	const { normalized, zip, pumaGeoId } = await timings.time('geocode', async () => {
		const normalized = deps.normalizeBuildingAddress(submission.address);
		const geocoded = await deps.geocodeAddress(submission.address, fetch);
		const zip = normalized.zip ?? geocoded.zip;
		return { normalized, zip, pumaGeoId: geocoded.pumaGeoId };
	});
	if (!normalized.building || !zip) {
		return respond({ versions: [], error: 'missing_zip' }, { status: 422, headers: noStore });
	}

	let zipInfo: Awaited<ReturnType<typeof lookupZip>>;
	try {
		zipInfo = await timings.time('zip_lookup', () => deps.lookupZip(zip));
		if (!zipInfo) {
			return respond(
				{ versions: [], error: 'unsupported_zip' },
				{ status: 422, headers: noStore }
			);
		}
	} catch {
		return respond(
			{ versions: [], error: 'submission_unavailable' },
			{ status: 503, headers: noStore }
		);
	}

	let versions: Awaited<ReturnType<typeof buildNegotiationEmail>>['versions'];
	try {
		({ versions } = await timings.time('negotiation_email_generation', () =>
			deps.buildNegotiationEmail(
				{
					address: normalized.building,
					aptType: submission.aptType,
					rentCents: submission.rentCents,
					zip: zipInfo.zip,
					pumaGeoId,
					countyFips: zipInfo.countyFips,
					cbsaCode: zipInfo.cbsaCode
				},
				fetch
			)
		));
	} catch {
		return respond(
			{ versions: [], error: 'email_generation_unavailable' },
			{ status: 503, headers: noStore }
		);
	}

	if (!deps.db) {
		return respond({ versions: [], error: 'unavailable' }, { status: 503, headers: noStore });
	}
	const database = deps.db;

	let verifyResult: VerifyCodeResult;
	try {
		verifyResult = await timings.time('otp_transaction', () =>
			database.transaction(async (tx): Promise<VerifyCodeResult> => {
				const result = await deps.consumeVerifiedCodeTx(tx, emailParsed.data, codeParsed.data);
				if (!result.ok) return result;

				await deps.insertSubmissionUnlessRecentDuplicateTx(tx, {
					buildingAddress: normalized.building,
					addressHash: normalized.addressHash,
					unitHash: normalized.unitHash,
					zip: zipInfo.zip,
					countyFips: zipInfo.countyFips,
					cbsaCode: zipInfo.cbsaCode,
					aptType: submission.aptType,
					rentCents: submission.rentCents,
					leaseExpiry: submission.leaseExpiry
				});

				return { ok: true };
			})
		);
	} catch {
		return respond(
			{ versions: [], error: 'submission_unavailable' },
			{ status: 503, headers: noStore }
		);
	}

	if (!verifyResult.ok) {
		return respond(
			{ versions: [], error: verifyResult.reason },
			{ status: statusForVerifyResult(verifyResult), headers: noStore }
		);
	}

	return respond({ versions }, { headers: noStore });
	};
}

export const POST = _createVerifyCheckPost({
	consumeRateLimit,
	getClientIp,
	consumeVerifiedCodeTx,
	verifyAddressExists,
	buildNegotiationEmail,
	normalizeBuildingAddress,
	geocodeAddress,
	lookupZip,
	insertSubmissionUnlessRecentDuplicateTx,
	db,
	getMapboxToken: () => env.MAPBOX_TOKEN
});
