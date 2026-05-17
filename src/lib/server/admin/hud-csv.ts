// Serialize HUD rows to CSV in shapes the upload pipeline already understands.
// - County FMR CSV header matches src/lib/server/admin/fmr-csv.ts exactly so
//   the downloaded file round-trips through /admin/upload/fmr with no transform.
// - SAFMR CSV is ZIP-level (new format; download-only today).

import type { HudFmrRow, HudSafmrRow } from './hud-files';
import type { HvsVacancyRow } from './census-hvs';

function csvEscape(value: string | number): string {
	const s = String(value);
	if (/[",\n\r]/.test(s)) {
		return `"${s.replace(/"/g, '""')}"`;
	}
	return s;
}

function toLine(cells: Array<string | number>): string {
	return cells.map(csvEscape).join(',');
}

export function toCountyFmrCsv(rows: HudFmrRow[]): string {
	const header = ['year', 'county_fips', 'apt_type', 'fmr_cents'];
	const lines = [toLine(header)];
	for (const r of rows) {
		lines.push(toLine([r.year, r.countyFips, r.aptType, r.fmrCents]));
	}
	return lines.join('\n') + '\n';
}

export function toSafmrCsv(rows: HudSafmrRow[]): string {
	const header = ['year', 'cbsa_code', 'zip', 'apt_type', 'fmr_cents'];
	const lines = [toLine(header)];
	for (const r of rows) {
		lines.push(toLine([r.year, r.cbsaCode, r.zip, r.aptType, r.fmrCents]));
	}
	return lines.join('\n') + '\n';
}

/**
 * Vacancy CSV header matches `/admin/upload/vacancy` parser exactly
 * (see src/lib/server/admin/vacancy-csv.ts), so it round-trips without transform.
 */
export function toVacancyCsv(rows: HvsVacancyRow[]): string {
	const header = ['year', 'quarter', 'cbsa_code', 'rental_vacancy_pct'];
	const lines = [toLine(header)];
	for (const r of rows) {
		lines.push(toLine([r.year, r.quarter, r.cbsaCode, r.rentalVacancyPct.toFixed(2)]));
	}
	return lines.join('\n') + '\n';
}
