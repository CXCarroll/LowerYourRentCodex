import type { RequestHandler } from './$types';
import { findCity } from '$lib/shared/top-cities';
import { fetchHvsVacancy, HvsFileError } from '$lib/server/admin/census-hvs';
import { toVacancyCsv } from '$lib/server/admin/hud-csv';
import { csvErrorResponse, csvResponse } from '$lib/server/admin/download-response';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.admin) {
		return csvErrorResponse('census-hvs-vacancy_UNAUTHORIZED', 401, ['Not signed in.']);
	}

	const city = findCity(url.searchParams.get('city') ?? '');
	if (!city) {
		return csvErrorResponse('census-hvs-vacancy_BAD_REQUEST', 400, ['Unknown city.']);
	}

	const yearParam = url.searchParams.get('year');
	const yearFilter = yearParam === null || yearParam === '' ? null : Number(yearParam);
	if (yearFilter !== null && !Number.isInteger(yearFilter)) {
		return csvErrorResponse(`census-hvs-vacancy-${city.slug}_BAD_REQUEST`, 400, [
			`Invalid year "${yearParam}".`
		]);
	}

	const filenameSuffix = yearFilter !== null ? `-${yearFilter}` : '-all';

	try {
		const all = await fetchHvsVacancy();
		const rows = all
			.filter(
				(r) => r.cbsaCode === city.cbsaCode && (yearFilter === null || r.year === yearFilter)
			)
			.sort((a, b) => a.year - b.year || a.quarter - b.quarter);
		if (rows.length === 0) {
			return csvErrorResponse(`census-hvs-vacancy-${city.slug}${filenameSuffix}_EMPTY`, 404, [
				`No Census HVS vacancy data found for ${city.name} (CBSA ${city.cbsaCode})${
					yearFilter !== null ? ` in ${yearFilter}` : ''
				}.`,
				'HVS only covers the ~75 largest US metros. Confirm your city is in scope at:',
				'  https://www.census.gov/housing/hvs/data/rates.html'
			]);
		}
		return csvResponse(
			`census-hvs-vacancy-${city.slug}${filenameSuffix}.csv`,
			toVacancyCsv(rows)
		);
	} catch (err) {
		if (err instanceof HvsFileError) {
			return csvErrorResponse(
				`census-hvs-vacancy-${city.slug}${filenameSuffix}_FETCH_FAILED`,
				502,
				[
					`Census HVS download failed for ${city.name}${
						yearFilter !== null ? ` (${yearFilter})` : ''
					}.`,
					'Tried the following public URLs:',
					...err.urlsTried.map((u) => `  ${u}`),
					'',
					'Census may have moved the file. Download it manually from:',
					'  https://www.census.gov/housing/hvs/data/rates.html',
					'Then reshape to CSV with header:',
					'  year,quarter,cbsa_code,rental_vacancy_pct'
				]
			);
		}
		throw err;
	}
};
