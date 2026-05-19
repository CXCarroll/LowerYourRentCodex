// Cloudflare Turnstile token verification.
//
// Environment-gated: when TURNSTILE_SECRET_KEY is unset (local dev / template
// mode) the check is disabled and every request passes. Set the key in
// production to enforce. The address is never involved here — no PII.

import { env } from './env';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Returns `true` if the request may proceed.
 *
 * - DEMO_MODE on               → `true` (bot check bypassed).
 * - No secret key configured  → `true` (bot check disabled).
 * - Secret key set, no token   → `false` (reject).
 * - Cloudflare transport error/timeout → `true` (fail-open: a CF outage must
 *   not break the public flow; only a definitive `success:false` rejects).
 */
export async function verifyTurnstileToken(
	token: string | null,
	ip: string,
	fetchFn: typeof fetch
): Promise<boolean> {
	if (env.DEMO_MODE) return true; // demo mode — bot check bypassed
	const secret = env.TURNSTILE_SECRET_KEY;
	if (!secret) return true; // dev / template mode — check disabled
	if (!token) return false; // keys set but no token ⇒ reject

	try {
		const form = new URLSearchParams({ secret, response: token });
		if (ip && ip !== 'unknown') form.set('remoteip', ip);
		const res = await fetchFn(SITEVERIFY, {
			method: 'POST',
			body: form,
			signal: AbortSignal.timeout(5_000)
		});
		if (!res.ok) return true; // Cloudflare unreachable ⇒ fail-open
		const data = (await res.json()) as { success?: boolean };
		return data?.success === true;
	} catch {
		return true; // transport error / timeout ⇒ fail-open
	}
}
