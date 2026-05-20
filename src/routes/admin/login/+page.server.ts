import { fail, redirect, type Actions } from '@sveltejs/kit';
import { createAdminSession, verifyAdminPassword } from '$lib/server/admin/auth';
import {
	checkAdminLoginBackoff,
	consumeLoginAttempt,
	recordFailedAdminLogin,
	resetAdminLoginBackoff
} from '$lib/server/admin/login-rate-limit';
import { getClientIp } from '$lib/server/rate-limit';

export const actions: Actions = {
	default: async (event) => {
		const { request, cookies, url } = event;
		const form = await request.formData();
		const password = String(form.get('password') ?? '');
		const nextRaw = String(form.get('next') ?? url.searchParams.get('next') ?? '/admin');
		// Don't let `next` be used as an open-redirect — only same-site admin paths allowed.
		const next = nextRaw.startsWith('/admin') ? nextRaw : '/admin';

		const ip = getClientIp(event);
		const gate = await consumeLoginAttempt(ip);
		if (!gate.ok) {
			return fail(gate.reason === 'unavailable' ? 503 : 401, { message: 'Invalid credentials.' });
		}

		const accountGate = await checkAdminLoginBackoff();
		if (!accountGate.ok) {
			return fail(accountGate.reason === 'unavailable' ? 503 : 401, {
				message: 'Invalid credentials.'
			});
		}

		if (password.length === 0) {
			return fail(400, { message: 'Password is required.' });
		}

		const ok = await verifyAdminPassword(password);
		if (!ok) {
			await recordFailedAdminLogin();
			return fail(401, { message: 'Invalid credentials.' });
		}

		await resetAdminLoginBackoff();
		await createAdminSession(cookies);
		throw redirect(303, next);
	}
};
