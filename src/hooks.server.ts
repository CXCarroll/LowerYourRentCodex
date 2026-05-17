import { redirect, type Handle } from '@sveltejs/kit';
import { isAdminConfigured, loadAdminSession } from '$lib/server/admin/auth';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.admin = null;
	const path = event.url.pathname;
	const isAdminPath = path === '/admin' || path.startsWith('/admin/');

	if (!isAdminPath) {
		return resolve(event);
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
	// Don't cache anything under /admin; don't let search engines index it.
	response.headers.set('Cache-Control', 'no-store, private');
	response.headers.set('X-Robots-Tag', 'noindex, nofollow');
	return response;
};
