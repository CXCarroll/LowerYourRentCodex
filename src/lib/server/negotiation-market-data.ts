import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { assertDb } from './db/client';
import {
	acsRent,
	buildingPermits,
	hudFmr,
	submissions,
	vacancyRates,
	zipCounty
} from './db/schema';
import type { AptType } from '$lib/shared/apt-types';

export interface NegotiationMarketData {
	zip: string;
	countyFips: string | null;
	cbsaCode: string | null;
	userComps: number[];
	acsMedianCents: number | null;
	fmrCents: number | null;
	latestVacancyPct: number | null;
	recentPermits5Plus: number | null;
	recentPermitsFirstYear: number | null;
	recentPermitsLastYear: number | null;
}

export interface NegotiationMarketDataInput {
	zip: string;
	aptType: AptType;
	countyFips?: string | null;
	cbsaCode?: string | null;
}

interface PermitRow {
	year: number;
	month: number;
	units5plus: number;
}

function summarizeRecentPermits(rows: PermitRow[]): {
	units5yr: number | null;
	firstYear: number | null;
	lastYear: number | null;
} {
	const byYear = new Map<number, { units5plus: number; hasAnnual: boolean }>();
	for (const row of rows) {
		const prev = byYear.get(row.year) ?? { units5plus: 0, hasAnnual: false };
		if (row.month === 0) {
			byYear.set(row.year, { units5plus: row.units5plus, hasAnnual: true });
		} else if (!prev.hasAnnual) {
			prev.units5plus += row.units5plus;
			byYear.set(row.year, prev);
		}
	}

	const recent = Array.from(byYear.entries())
		.sort((a, b) => a[0] - b[0])
		.slice(-5);
	if (recent.length === 0) {
		return { units5yr: null, firstYear: null, lastYear: null };
	}
	return {
		units5yr: recent.reduce((sum, [, value]) => sum + value.units5plus, 0),
		firstYear: recent[0][0],
		lastYear: recent[recent.length - 1][0]
	};
}

export async function loadNegotiationMarketData({
	zip,
	aptType,
	countyFips: knownCountyFips,
	cbsaCode: knownCbsaCode
}: NegotiationMarketDataInput): Promise<NegotiationMarketData | null> {
	if (!/^\d{5}$/.test(zip)) return null;
	const db = assertDb();

	let countyFips = knownCountyFips;
	let cbsaCode = knownCbsaCode;
	if (countyFips === undefined || cbsaCode === undefined) {
		const zcRows = await db
			.select({ countyFips: zipCounty.countyFips, cbsaCode: zipCounty.cbsaCode })
			.from(zipCounty)
			.where(eq(zipCounty.zip, zip))
			.limit(1);
		if (zcRows.length === 0) return null;
		countyFips = zcRows[0].countyFips;
		cbsaCode = zcRows[0].cbsaCode;
	}

	const [userRows, acsRows, fmrRows, vacancyRows, permitRows] = await Promise.all([
		db
			.select({ rentCents: submissions.rentCents })
			.from(submissions)
			.where(
				and(
					eq(submissions.zip, zip),
					eq(submissions.aptType, aptType),
					gt(submissions.createdAt, sql`now() - interval '365 days'`)
				)
			),
		db
			.select({ median: acsRent.medianGrossRentCents })
			.from(acsRent)
			.where(and(eq(acsRent.geoLevel, 'zcta'), eq(acsRent.geoId, zip)))
			.orderBy(desc(acsRent.year))
			.limit(1),
		countyFips
			? db
					.select({ fmrCents: hudFmr.fmrCents })
					.from(hudFmr)
					.where(and(eq(hudFmr.countyFips, countyFips), eq(hudFmr.aptType, aptType)))
					.orderBy(desc(hudFmr.year))
					.limit(1)
			: Promise.resolve([]),
		cbsaCode
			? db
					.select({ pct: vacancyRates.rentalVacancyPct })
					.from(vacancyRates)
					.where(eq(vacancyRates.cbsaCode, cbsaCode))
					.orderBy(desc(vacancyRates.year), desc(vacancyRates.quarter))
					.limit(1)
			: Promise.resolve([]),
		cbsaCode
			? db
					.select({
						year: buildingPermits.year,
						month: buildingPermits.month,
						units5plus: buildingPermits.units5plus
					})
					.from(buildingPermits)
					.where(
						and(
							eq(buildingPermits.cbsaCode, cbsaCode),
							sql`${buildingPermits.year} >= (
								select coalesce(max(${buildingPermits.year}) - 6, 0)
								from ${buildingPermits}
								where ${buildingPermits.cbsaCode} = ${cbsaCode}
							)`
						)
					)
					.orderBy(buildingPermits.year, buildingPermits.month)
			: Promise.resolve([])
	]);

	const permits = summarizeRecentPermits(permitRows);
	return {
		zip,
		countyFips,
		cbsaCode,
		userComps: userRows.map((row) => row.rentCents),
		acsMedianCents: acsRows[0]?.median ?? null,
		fmrCents: fmrRows[0]?.fmrCents ?? null,
		latestVacancyPct: vacancyRows.length > 0 ? Number(vacancyRows[0].pct) : null,
		recentPermits5Plus: permits.units5yr,
		recentPermitsFirstYear: permits.firstYear,
		recentPermitsLastYear: permits.lastYear
	};
}
