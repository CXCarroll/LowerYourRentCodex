// Verification-code email delivery via Resend.
//
// Dev / template mode: when RESEND_API_KEY or EMAIL_FROM is unset in a
// non-production environment, the code is printed to the server console
// instead of sent — mirrors how turnstile.ts and mapbox.ts no-op without keys,
// so the negotiate flow works locally with no Resend account. In production,
// missing keys are a hard failure: the code is never logged and the caller
// surfaces an error, so the misconfiguration is loud rather than silent.
//
// Unlike Turnstile, this does NOT fail open on a real send failure: a silently
// dropped code dead-ends the flow with no way forward, so the caller surfaces
// the false return as an error to the user.

import { Resend } from 'resend';
import { env } from './env';

const SUBJECT = 'Your Lower Your Rent verification code';

function textBody(code: string): string {
	return `Your Lower Your Rent verification code is ${code}

Enter it on the page to draft your negotiation email. The code expires in 10 minutes.

If you didn't request this, you can ignore this email.`;
}

function htmlBody(code: string): string {
	return `<div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #1e1e28; max-width: 420px;">
  <p>Your Lower Your Rent verification code is:</p>
  <p style="font-size: 32px; font-weight: 700; letter-spacing: 6px; margin: 16px 0;">${code}</p>
  <p>Enter it on the page to draft your negotiation email. The code expires in 10 minutes.</p>
  <p style="color: #6b6b78; font-size: 13px;">If you didn't request this, you can ignore this email.</p>
</div>`;
}

/**
 * Email a 6-digit verification code. Returns `true` on success (or in dev mode,
 * where the code is console-logged), `false` if a real send failed.
 */
export async function sendVerificationCode(email: string, code: string): Promise<boolean> {
	// Demo mode: the code is the fixed "123456" (see email-verification.ts) and
	// no email is sent — report success so the flow proceeds.
	if (env.DEMO_MODE) return true;
	if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
		// In production, never log the code (PII + code leak) and never report
		// success — a missing key must surface as an error, not a silent no-op.
		if (env.NODE_ENV === 'production') {
			console.error('[email] RESEND_API_KEY / EMAIL_FROM not configured — cannot send code.');
			return false;
		}
		console.log(`[email] verification code for ${email}: ${code}`);
		return true;
	}

	try {
		const resend = new Resend(env.RESEND_API_KEY);
		const { error } = await resend.emails.send({
			from: env.EMAIL_FROM,
			to: email,
			subject: SUBJECT,
			text: textBody(code),
			html: htmlBody(code)
		});
		if (error) {
			console.error('[email] Resend send failed:', error);
			return false;
		}
		return true;
	} catch (err) {
		console.error('[email] Resend send threw:', err);
		return false;
	}
}
