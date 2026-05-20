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
import { geocodeAddressToZip } from '$lib/server/geocode';
import { lookupZip } from '$lib/server/geo';
import { insertSubmissionUnlessRecentDuplicateTx } from '$lib/server/submissions';
import { db } from '$lib/server/db/client';

const noStore = { 'Cache-Control': 'no-store' };

function statusForVerifyResult(result: Exclude<VerifyCodeResult, { ok: true }>): number {
	if (result.reason === 'bad_code') return 401;
	if (result.reason === 'too_many_attempts') return 429;
	if (result.reason === 'unavailable') return 503;
	return 410; // expired | not_found
}

export const POST: RequestHandler = async (event) => {
	const { request, fetch } = event;
	const ip = getClientIp(event);
	const ipGate = await consumeRateLimit({
		scope: 'otp_check_ip',
		key: ip,
		limit: 10,
		windowMs: 60_000
	});
	if (!ipGate.ok) {
		return json(
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
	try {
		payload = await request.json();
	} catch {
		return json({ versions: [], error: 'bad_request' }, { status: 400, headers: noStore });
	}

	const emailParsed = emailSchema.safeParse(payload.email);
	const codeParsed = verificationCodeSchema.safeParse(payload.code);
	if (!emailParsed.success || !codeParsed.success) {
		return json({ versions: [], error: 'invalid_input' }, { status: 422, headers: noStore });
	}

	const submissionParsed = submissionSchema.safeParse({
		address: payload.address,
		aptType: payload.aptType,
		rentCents: payload.rentCents,
		leaseExpiry: payload.leaseExpiry
	});
	if (!submissionParsed.success) {
		return json(
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
	const submission = submissionParsed.data;

	// Verify the address BEFORE the code so a bad address doesn't consume the
	// code or burn a verification attempt. Disabled when MAPBOX_TOKEN is unset.
	const addressOk = await verifyAddressExists(submission.address, env.MAPBOX_TOKEN, fetch);
	if (!addressOk) {
		return json({ versions: [], error: 'address_not_found' }, { status: 422, headers: noStore });
	}

	const normalized = normalizeBuildingAddress(submission.address);
	const zip = normalized.zip ?? (await geocodeAddressToZip(submission.address, fetch));
	if (!normalized.building || !zip) {
		return json({ versions: [], error: 'missing_zip' }, { status: 422, headers: noStore });
	}

	let zipInfo: Awaited<ReturnType<typeof lookupZip>>;
	try {
		zipInfo = await lookupZip(zip);
		if (!zipInfo) {
			return json({ versions: [], error: 'unsupported_zip' }, { status: 422, headers: noStore });
		}
	} catch {
		return json(
			{ versions: [], error: 'submission_unavailable' },
			{ status: 503, headers: noStore }
		);
	}

	let versions: Awaited<ReturnType<typeof buildNegotiationEmail>>['versions'];
	try {
		({ versions } = await buildNegotiationEmail(
			{
				address: normalized.building,
				aptType: submission.aptType,
				rentCents: submission.rentCents,
				zip: zipInfo.zip
			},
			fetch
		));
	} catch {
		return json(
			{ versions: [], error: 'email_generation_unavailable' },
			{ status: 503, headers: noStore }
		);
	}

	if (!db) {
		return json({ versions: [], error: 'unavailable' }, { status: 503, headers: noStore });
	}

	let verifyResult: VerifyCodeResult;
	try {
		verifyResult = await db.transaction(async (tx): Promise<VerifyCodeResult> => {
			const result = await consumeVerifiedCodeTx(tx, emailParsed.data, codeParsed.data);
			if (!result.ok) return result;

			await insertSubmissionUnlessRecentDuplicateTx(tx, {
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
		});
	} catch {
		return json(
			{ versions: [], error: 'submission_unavailable' },
			{ status: 503, headers: noStore }
		);
	}

	if (!verifyResult.ok) {
		return json(
			{ versions: [], error: verifyResult.reason },
			{ status: statusForVerifyResult(verifyResult), headers: noStore }
		);
	}

	return json({ versions }, { headers: noStore });
};
