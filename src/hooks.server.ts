import { redirect, type Handle, type ServerInit } from '@sveltejs/kit';
import { isAdminConfigured, loadAdminSession } from '$lib/server/admin/auth';
import { startVerificationReaper } from '$lib/server/email-verification';
import { reapExpiredRateLimitBuckets } from '$lib/server/rate-limit';
import { env } from '$lib/server/env';

export const init: ServerInit = () => {
	startVerificationReaper();
	const timer = setInterval(() => {
		reapExpiredRateLimitBuckets().catch(() => {});
	}, 15 * 60 * 1000);
	timer.unref?.();
};

// Baseline security headers applied to every response. CSP is handled
// separately by SvelteKit (see kit.csp in svelte.config.js) so its inline
// scripts get the right nonces.
function applySecurityHeaders(response: Response): void {
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	if (env.NODE_ENV === 'production') {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}
}

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.admin = null;
	const path = event.url.pathname;
	const isAdminPath = path === '/admin' || path.startsWith('/admin/');

	if (!isAdminPath) {
		const response = await resolve(event);
		applySecurityHeaders(response);
		return response;
	}

	// Admin disabled until the operator sets ADMIN_PASSWORD_HASH.
	if (!isAdminConfigured()) {
		return new Response(
			'Admin area is not configured. Set ADMIN_PASSWORD_HASH in the environment (run `bun run admin:password`) and restart.',
			{ status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
		);
	}

	event.locals.admin = await loadAdminSession(event.cookies);

	const isLoginPath = path === '/admin/login';
	if (!event.locals.admin && !isLoginPath) {
		throw redirect(303, `/admin/login?next=${encodeURIComponent(path)}`);
	}
	if (event.locals.admin && isLoginPath) {
		throw redirect(303, '/admin');
	}

	const response = await resolve(event);
	applySecurityHeaders(response);
	// Don't cache anything under /admin; don't let search engines index it.
	response.headers.set('Cache-Control', 'no-store, private');
	response.headers.set('X-Robots-Tag', 'noindex, nofollow');
	return response;
};
