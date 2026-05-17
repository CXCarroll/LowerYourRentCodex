import { fail, redirect, type Actions } from '@sveltejs/kit';
import { createAdminSession, verifyAdminPassword } from '$lib/server/admin/auth';
import { consumeLoginAttempt } from '$lib/server/admin/login-rate-limit';
import { getClientIp } from '$lib/server/rate-limit';

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const password = String(form.get('password') ?? '');
		const nextRaw = String(form.get('next') ?? url.searchParams.get('next') ?? '/admin');
		// Don't let `next` be used as an open-redirect — only same-site admin paths allowed.
		const next = nextRaw.startsWith('/admin') ? nextRaw : '/admin';

		const ip = getClientIp(request);
		const gate = consumeLoginAttempt(ip);
		if (!gate.ok) {
			return fail(401, { message: 'Invalid credentials.' });
		}

		if (password.length === 0) {
			return fail(400, { message: 'Password is required.' });
		}

		const ok = await verifyAdminPassword(password);
		if (!ok) {
			return fail(401, { message: 'Invalid credentials.' });
		}

		await createAdminSession(cookies);
		throw redirect(303, next);
	}
};
