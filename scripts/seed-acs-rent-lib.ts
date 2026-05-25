import { zip5 } from './_seed-helpers';

export const ACS_RENT_VAR = 'B25064_001E';
export const ACS_UNITS_VAR = 'B25001_001E';
export const DEFAULT_ACS_YEARS = [2024, 2023, 2022, 2021, 2020] as const;

export interface AcsRow {
	year: number;
	geoLevel: 'zcta';
	geoId: string;
	medianGrossRentCents: number;
	sampleSize: number | null;
}

export interface AcsParseResult {
	rows: AcsRow[];
	skippedInvalidRentRows: number;
	skippedInvalidGeoRows: number;
}

export interface AcsSeedConfig {
	apiKey: string | null;
	requireApiKey: boolean;
	yearsToTry: number[];
}

export interface FetchedAcsYear extends AcsParseResult {
	url: string;
}

export type AcsFetchText = (
	url: string,
	logUrl: string,
	validate: (text: string) => void
) => Promise<string>;

export function redactedUrl(url: string): string {
	const u = new URL(url);
	if (u.searchParams.has('key')) u.searchParams.set('key', '[redacted]');
	return u.toString();
}

export function getAcsSeedConfig(env: Record<string, string | undefined>): AcsSeedConfig {
	const apiKey = env.CENSUS_API_KEY?.trim() || null;
	const requireApiKey = env.ACS_REQUIRE_API_KEY === 'true' || env.ACS_REQUIRE_API_KEY === '1';
	if (requireApiKey && !apiKey) {
		throw new Error('ACS_REQUIRE_API_KEY=true but CENSUS_API_KEY is not set.');
	}

	const yearRaw = env.ACS_YEAR?.trim();
	if (yearRaw) {
		const year = Number(yearRaw);
		if (!Number.isInteger(year) || year < 2000 || year > new Date().getUTCFullYear() + 1) {
			throw new Error(`ACS_YEAR must be a valid ACS year (got "${yearRaw}").`);
		}
		return { apiKey, requireApiKey, yearsToTry: [year] };
	}

	return { apiKey, requireApiKey, yearsToTry: [...DEFAULT_ACS_YEARS] };
}

export function buildAcsUrl(year: number, apiKey: string | null): string {
	const params = new URLSearchParams({
		get: `${ACS_RENT_VAR},${ACS_UNITS_VAR}`,
		for: 'zip code tabulation area:*'
	});
	if (apiKey) params.set('key', apiKey);
	return `https://api.census.gov/data/${year}/acs/acs5?${params.toString()}`;
}

function parseCensusJson(text: string): unknown[][] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (err) {
		throw new Error(`Census response is not valid JSON: ${(err as Error).message}`);
	}
	if (!Array.isArray(parsed)) {
		if (parsed && typeof parsed === 'object' && 'error' in parsed) {
			throw new Error(`Census API error: ${String((parsed as { error?: unknown }).error)}`);
		}
		throw new Error('Census response must be a JSON array.');
	}
	if (parsed.length < 2) {
		throw new Error('Census response did not include any data rows.');
	}
	if (!Array.isArray(parsed[0])) {
		throw new Error('Census response header row is malformed.');
	}
	return parsed as unknown[][];
}

export function validateAcsApiResponse(text: string): void {
	const arr = parseCensusJson(text);
	const header = arr[0] as unknown[];
	if (!header.every((h) => typeof h === 'string')) {
		throw new Error('Census response header contains non-string columns.');
	}
	const headers = header as string[];
	const missing = [ACS_RENT_VAR, ACS_UNITS_VAR].filter((h) => !headers.includes(h));
	const hasZcta = headers.some((h) => /zip|zcta/i.test(h));
	if (missing.length > 0 || !hasZcta) {
		const parts: string[] = [];
		if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
		if (!hasZcta) parts.push('missing: ZCTA geography column');
		throw new Error(`Census response missing required columns (${parts.join('; ')})`);
	}
}

export function parseAcsApiResponse(text: string, year: number): AcsParseResult {
	validateAcsApiResponse(text);
	const arr = JSON.parse(text) as unknown[][];
	const [header, ...rows] = arr;
	const headers = header as string[];
	const idxRent = headers.indexOf(ACS_RENT_VAR);
	const idxUnits = headers.indexOf(ACS_UNITS_VAR);
	const idxZcta = headers.findIndex((h) => /zip|zcta/i.test(h));

	const out: AcsRow[] = [];
	let skippedInvalidRentRows = 0;
	let skippedInvalidGeoRows = 0;
	for (const row of rows) {
		if (!Array.isArray(row)) continue;
		const rentDollars = Number(row[idxRent]);
		const units = Number(row[idxUnits]);
		const zcta = zip5(String(row[idxZcta]));
		if (!zcta) {
			skippedInvalidGeoRows += 1;
			continue;
		}
		// Census marks missing data as negative numbers (-666666666 etc.)
		if (!Number.isFinite(rentDollars) || rentDollars <= 0) {
			skippedInvalidRentRows += 1;
			continue;
		}
		out.push({
			year,
			geoLevel: 'zcta',
			geoId: zcta,
			medianGrossRentCents: Math.round(rentDollars * 100),
			sampleSize: Number.isFinite(units) && units > 0 ? Math.round(units) : null
		});
	}
	return { rows: out, skippedInvalidRentRows, skippedInvalidGeoRows };
}

export async function fetchAndParseAcsYear(
	year: number,
	apiKey: string | null,
	fetchText: AcsFetchText
): Promise<FetchedAcsYear> {
	const url = buildAcsUrl(year, apiKey);
	const text = await fetchText(url, redactedUrl(url), validateAcsApiResponse);
	return { ...parseAcsApiResponse(text, year), url };
}
