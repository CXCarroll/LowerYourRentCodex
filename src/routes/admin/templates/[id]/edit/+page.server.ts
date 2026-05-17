import { eq } from 'drizzle-orm';
import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { assertDb } from '$lib/server/db/client';
import { emailTemplates } from '$lib/server/db/schema';
import { isAggressiveness, isAudience } from '$lib/shared/email-template';

function trim(v: FormDataEntryValue | null, max: number): string {
	if (typeof v !== 'string') return '';
	return v.trim().slice(0, max);
}

async function loadTemplate(id: string) {
	const db = assertDb();
	const rows = await db.select().from(emailTemplates).where(eq(emailTemplates.id, id)).limit(1);
	if (rows.length === 0) throw error(404, 'Template not found');
	return rows[0];
}

export const load: PageServerLoad = async ({ params }) => {
	const template = await loadTemplate(params.id);
	return { template };
};

export const actions: Actions = {
	save: async ({ request, params, locals }) => {
		if (!locals.admin) return fail(401, { message: 'Not signed in.' });
		const existing = await loadTemplate(params.id!);
		const data = await request.formData();

		const name = trim(data.get('name'), 160);
		const body = trim(data.get('body'), 20_000);
		const rawAudience = data.get('audience');
		const rawAggressiveness = data.get('aggressiveness');
		if (!name) return fail(400, { message: 'Name is required.' });
		if (!body) return fail(400, { message: 'Body is required.' });
		if (!isAudience(rawAudience)) return fail(400, { message: 'Invalid audience.' });
		if (!isAggressiveness(rawAggressiveness))
			return fail(400, { message: 'Invalid aggressiveness.' });

		const db = assertDb();
		await db
			.update(emailTemplates)
			.set({
				name,
				body,
				audience: rawAudience,
				aggressiveness: rawAggressiveness,
				updatedAt: new Date()
			})
			.where(eq(emailTemplates.id, existing.id));

		return { saved: true };
	},

	activate: async ({ params, locals }) => {
		if (!locals.admin) return fail(401, { message: 'Not signed in.' });
		const existing = await loadTemplate(params.id!);
		const db = assertDb();
		await db
			.update(emailTemplates)
			.set({ status: 'active', updatedAt: new Date() })
			.where(eq(emailTemplates.id, existing.id));
		return { saved: true };
	},

	deactivate: async ({ params, locals }) => {
		if (!locals.admin) return fail(401, { message: 'Not signed in.' });
		const existing = await loadTemplate(params.id!);
		const db = assertDb();
		await db
			.update(emailTemplates)
			.set({ status: 'inactive', updatedAt: new Date() })
			.where(eq(emailTemplates.id, existing.id));
		return { saved: true };
	},

	delete: async ({ params, locals }) => {
		if (!locals.admin) return fail(401, { message: 'Not signed in.' });
		const existing = await loadTemplate(params.id!);
		const db = assertDb();
		await db.delete(emailTemplates).where(eq(emailTemplates.id, existing.id));
		throw redirect(303, '/admin/templates');
	}
};
