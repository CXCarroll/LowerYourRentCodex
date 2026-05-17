// Step 1 of the negotiate flow: the user enters their email and we mail them a
// 6-digit verification code. The Cloudflare Turnstile bot check lives here —
// this is the first user-triggered server call. The code itself is never
// echoed in the response.

import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { consumeIpToken, getClientIp } from '$lib/server/rate-limit';
import { verifyTurnstileToken } from '$lib/server/turnstile';
import { emailSchema } from '$lib/shared/validation';
import { requestCode, reapExpiredVerifications } from '$lib/server/email-verification';
import { sendVerificationCode } from '$lib/server/email';

const noStore = { 'Cache-Control': 'no-store' };

export const POST: RequestHandler = async ({ request, fetch }) => {
	const ip = getClientIp(request);
	if (!consumeIpToken(ip).ok) {
		return json({ ok: false, error: 'rate_limited' }, { status: 429, headers: noStore });
	}

	let payload: { email?: unknown; turnstileToken?: unknown };
	try {
		payload = await request.json();
	} catch {
		return json({ ok: false, error: 'bad_request' }, { status: 400, headers: noStore });
	}

	const turnstileToken =
		typeof payload.turnstileToken === 'string' ? payload.turnstileToken : null;
	const passed = await verifyTurnstileToken(turnstileToken, ip, fetch);
	if (!passed) {
		return json({ ok: false, error: 'turnstile_failed' }, { status: 403, headers: noStore });
	}

	const parsed = emailSchema.safeParse(payload.email);
	if (!parsed.success) {
		return json({ ok: false, error: 'invalid_email' }, { status: 422, headers: noStore });
	}
	const email = parsed.data;

	const result = await requestCode(email, ip);
	if (!result.ok) {
		const status = result.reason === 'rate_limited' ? 429 : 503;
		return json({ ok: false, error: result.reason }, { status, headers: noStore });
	}

	const sent = await sendVerificationCode(email, result.code);
	if (!sent) {
		return json({ ok: false, error: 'send_failed' }, { status: 502, headers: noStore });
	}

	// Opportunistic cleanup of expired rows — don't block the response on it.
	reapExpiredVerifications().catch(() => {});

	return json({ ok: true }, { headers: noStore });
};
