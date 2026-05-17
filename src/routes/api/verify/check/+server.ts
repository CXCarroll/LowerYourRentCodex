// Step 2 of the negotiate flow: the user submits the 6-digit code along with
// the form data they already hold (the flow is stateless — no server session
// for an anonymous user). On a valid code we generate and return the
// negotiation-email variations as `{ versions: [{ body, reductionCents }] }`.

import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { consumeIpToken, getClientIp } from '$lib/server/rate-limit';
import { APT_TYPES, type AptType } from '$lib/shared/apt-types';
import { emailSchema, verificationCodeSchema } from '$lib/shared/validation';
import { verifyCode } from '$lib/server/email-verification';
import { verifyAddressExists } from '$lib/server/mapbox';
import { buildNegotiationEmail } from '$lib/server/negotiation-email';
import { env } from '$lib/server/env';

const noStore = { 'Cache-Control': 'no-store' };

export const POST: RequestHandler = async ({ request, fetch }) => {
	const ip = getClientIp(request);
	if (!consumeIpToken(ip).ok) {
		return json({ versions: [], error: 'rate_limited' }, { status: 429, headers: noStore });
	}

	let payload: {
		email?: unknown;
		code?: unknown;
		address?: unknown;
		aptType?: unknown;
		rent?: unknown;
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

	const address = typeof payload.address === 'string' ? payload.address : '';
	const rent = typeof payload.rent === 'string' ? payload.rent : '';
	const aptType: AptType = APT_TYPES.includes(payload.aptType as AptType)
		? (payload.aptType as AptType)
		: '1br';

	// Verify the address BEFORE the code so a bad address doesn't consume the
	// code or burn a verification attempt. Disabled when MAPBOX_TOKEN is unset.
	const addressOk = await verifyAddressExists(address, env.MAPBOX_TOKEN, fetch);
	if (!addressOk) {
		return json({ versions: [], error: 'address_not_found' }, { status: 422, headers: noStore });
	}

	const result = await verifyCode(emailParsed.data, codeParsed.data);
	if (!result.ok) {
		const status =
			result.reason === 'bad_code'
				? 401
				: result.reason === 'too_many_attempts'
					? 429
					: result.reason === 'unavailable'
						? 503
						: 410; // expired | not_found
		return json({ versions: [], error: result.reason }, { status, headers: noStore });
	}

	const { versions } = await buildNegotiationEmail({ address, aptType, rent }, fetch);
	return json({ versions }, { headers: noStore });
};
