import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getZipInsight } from '$lib/server/admin/zip-explorer';

export const load: PageServerLoad = async () => {
	return {};
};

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const rawZip = String(form.get('zip') ?? '').trim();
		if (!/^\d{5}$/.test(rawZip)) {
			return fail(400, { zip: rawZip, error: 'Enter a 5-digit ZIP code.' });
		}
		const insight = await getZipInsight(rawZip);
		if (!insight) {
			return fail(404, {
				zip: rawZip,
				error: `No geographic data for ZIP ${rawZip}. It may not be a residential ZIP, or the crosswalk is missing this entry.`
			});
		}
		return { zip: rawZip, insight };
	}
};
