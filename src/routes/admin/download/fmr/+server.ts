import type { RequestHandler } from './$types';
import { findCity } from '$lib/shared/top-cities';
import {
	fetchFmrRows,
	HudFileError,
	HUD_FMR_AVAILABLE_YEARS
} from '$lib/server/admin/hud-files';
import { toCountyFmrCsv } from '$lib/server/admin/hud-csv';
import { csvErrorResponse, csvResponse } from '$lib/server/admin/download-response';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.admin) {
		return csvErrorResponse('hud-fmr_UNAUTHORIZED', 401, ['Not signed in.']);
	}

	const city = findCity(url.searchParams.get('city') ?? '');
	if (!city) {
		return csvErrorResponse('hud-fmr_BAD_REQUEST', 400, ['Unknown city.']);
	}

	const year = Number(url.searchParams.get('year'));
	if (!Number.isInteger(year) || !HUD_FMR_AVAILABLE_YEARS.includes(year as 2025)) {
		return csvErrorResponse(`hud-fmr-${city.slug}_BAD_REQUEST`, 400, [
			`Invalid year "${url.searchParams.get('year')}". Allowed: ${HUD_FMR_AVAILABLE_YEARS.join(', ')}.`
		]);
	}

	try {
		const all = await fetchFmrRows(year);
		const wanted = new Set(city.countyFips);
		const rows = all.filter((r) => wanted.has(r.countyFips));
		if (rows.length === 0) {
			return csvErrorResponse(`hud-fmr-${city.slug}-${year}_EMPTY`, 404, [
				`No FMR rows found for ${city.name} counties in ${year}.`,
				`Counties searched: ${city.countyFips.join(', ')}.`,
				'Try a different year, or see https://www.huduser.gov/portal/datasets/fmr.html.'
			]);
		}
		return csvResponse(`hud-fmr-${city.slug}-${year}.csv`, toCountyFmrCsv(rows));
	} catch (err) {
		if (err instanceof HudFileError) {
			return csvErrorResponse(
				`hud-fmr-${city.slug}-${year}_FETCH_FAILED`,
				502,
				[
					`HUD FMR download failed for ${city.name} (${year}).`,
					'Tried the following public URLs:',
					...err.urlsTried.map((u) => `  ${u}`),
					'',
					'HUD may have moved the file. Download it manually from:',
					'  https://www.huduser.gov/portal/datasets/fmr.html',
					'Then upload via /admin/upload/fmr after reshaping to:',
					'  year,county_fips,apt_type,fmr_cents'
				]
			);
		}
		throw err;
	}
};
