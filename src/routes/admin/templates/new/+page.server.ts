import { fail, redirect, type Actions } from '@sveltejs/kit';
import { assertDb } from '$lib/server/db/client';
import { emailTemplates } from '$lib/server/db/schema';
import { isAggressiveness, isAudience } from '$lib/shared/email-template';

function trim(v: FormDataEntryValue | null, max: number): string {
	if (typeof v !== 'string') return '';
	return v.trim().slice(0, max);
}

export const actions: Actions = {
	default: async ({ request, locals }) => {
		if (!locals.admin)
			return fail(401, {
				message: 'Not signed in.',
				name: '',
				body: '',
				audience: 'any' as const,
				aggressiveness: 'baseline' as const
			});

		const data = await request.formData();
		const name = trim(data.get('name'), 160);
		const body = trim(data.get('body'), 20_000);
		const rawAudience = data.get('audience');
		const audience = isAudience(rawAudience) ? rawAudience : null;
		const rawAggressiveness = data.get('aggressiveness');
		const aggressiveness = isAggressiveness(rawAggressiveness) ? rawAggressiveness : null;

		if (!name)
			return fail(400, {
				message: 'Name is required.',
				name,
				body,
				audience: audience ?? 'any',
				aggressiveness: aggressiveness ?? 'baseline'
			});
		if (!body)
			return fail(400, {
				message: 'Body is required.',
				name,
				body,
				audience: audience ?? 'any',
				aggressiveness: aggressiveness ?? 'baseline'
			});
		if (!audience)
			return fail(400, {
				message: 'Invalid audience.',
				name,
				body,
				audience: 'any' as const,
				aggressiveness: aggressiveness ?? 'baseline'
			});
		if (!aggressiveness)
			return fail(400, {
				message: 'Invalid aggressiveness.',
				name,
				body,
				audience,
				aggressiveness: 'baseline' as const
			});

		const db = assertDb();
		const [row] = await db
			.insert(emailTemplates)
			.values({ name, body, audience, aggressiveness, status: 'inactive' })
			.returning({ id: emailTemplates.id });

		throw redirect(303, `/admin/templates/${row.id}/edit`);
	}
};
