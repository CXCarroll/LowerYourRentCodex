import type { RequestHandler } from './$types';
import { findCity } from '$lib/shared/top-cities';
import {
	fetchSafmrRows,
	HudFileError,
	HUD_FMR_AVAILABLE_YEARS
} from '$lib/server/admin/hud-files';
import { toSafmrCsv } from '$lib/server/admin/hud-csv';
import { csvErrorResponse, csvResponse } from '$lib/server/admin/download-response';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.admin) {
		return csvErrorResponse('hud-safmr_UNAUTHORIZED', 401, ['Not signed in.']);
	}

	const city = findCity(url.searchParams.get('city') ?? '');
	if (!city) {
		return csvErrorResponse('hud-safmr_BAD_REQUEST', 400, ['Unknown city.']);
	}

	const year = Number(url.searchParams.get('year'));
	if (!Number.isInteger(year) || !HUD_FMR_AVAILABLE_YEARS.includes(year as 2025)) {
		return csvErrorResponse(`hud-safmr-${city.slug}_BAD_REQUEST`, 400, [
			`Invalid year "${url.searchParams.get('year')}". Allowed: ${HUD_FMR_AVAILABLE_YEARS.join(', ')}.`
		]);
	}

	try {
		const all = await fetchSafmrRows(year);
		const rows = all.filter((r) => r.cbsaCode === city.cbsaCode);
		if (rows.length === 0) {
			return csvErrorResponse(`hud-safmr-${city.slug}-${year}_EMPTY`, 404, [
				`HUD does not publish SAFMR for ${city.name} (CBSA ${city.cbsaCode}) in ${year}.`,
				'SAFMR only covers ~24 HUD-designated metros. See:',
				'  https://www.huduser.gov/portal/datasets/fmr/smallarea/index.html'
			]);
		}
		return csvResponse(`hud-safmr-${city.slug}-${year}.csv`, toSafmrCsv(rows));
	} catch (err) {
		if (err instanceof HudFileError) {
			return csvErrorResponse(
				`hud-safmr-${city.slug}-${year}_FETCH_FAILED`,
				502,
				[
					`HUD SAFMR download failed for ${city.name} (${year}).`,
					'Tried the following public URLs:',
					...err.urlsTried.map((u) => `  ${u}`),
					'',
					'HUD may have moved the file. Download it manually from:',
					'  https://www.huduser.gov/portal/datasets/fmr/smallarea/index.html',
					'Then reshape to CSV with header:',
					'  year,cbsa_code,zip,apt_type,fmr_cents'
				]
			);
		}
		throw err;
	}
};
