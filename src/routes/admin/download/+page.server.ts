import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { TOP_CITIES } from '$lib/shared/top-cities';
import { HUD_FMR_AVAILABLE_YEARS } from '$lib/server/admin/hud-files';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.admin) throw redirect(303, '/admin/login?next=/admin/download');
	return {
		cities: TOP_CITIES,
		availableYears: [...HUD_FMR_AVAILABLE_YEARS]
	};
};
