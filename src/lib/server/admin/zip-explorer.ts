// Read-only ZIP insights for the admin Explore page.
// Aggregates user submissions, ACS median rent, HUD FMR by apt type,
// and the latest CBSA vacancy rate. All queries are indexed.

import { and, eq, desc } from 'drizzle-orm';
import { assertDb } from '../db/client';
import {
	submissions,
	hudFmr,
	acsRent,
	vacancyRates,
	buildingPermits,
	cbsaPopulation,
	zipCounty,
	zipCentroids
} from '../db/schema';
import { APT_TYPES, type AptType } from '$lib/shared/apt-types';
import { resolveZipCentroid } from './zip-centroid';

// Supply-vs-demand verdict thresholds. Percentage-point gap between permits
// YoY growth and population YoY growth.
const SUPPLY_OUTPACING_PP = 10;
const DEMAND_OUTPACING_PP = -10;
const POPULATION_GROWTH_NOTABLE_PCT = 0.5;

export interface ZipInsight {
	zip: string;
	countyFips: string | null;
	cbsaCode: string | null;
	/** Map centroid for the ZIP, if we were able to resolve it. */
	lat: number | null;
	lng: number | null;
	submissionCount: number;
	medianRentCentsByAptType: Record<AptType, number | null>;
	acsMedianGrossRentCents: number | null;
	hudFmrCentsByAptType: Record<AptType, number | null>;
	/** Full per-year FMR series for the county, sorted by year ascending. */
	hudFmrHistoryByAptType: Record<AptType, Array<{ year: number; cents: number }>>;
	latestVacancyPct: number | null;
	latestVacancyPeriod: { year: number; quarter: number } | null;
	/** Full per-(year, quarter) vacancy series for the CBSA, ascending. */
	vacancyHistory: Array<{ year: number; quarter: number; pct: number }>;
	/** Annual Census BPS permit totals for the CBSA, ascending by year. */
	permitsHistory: Array<{
		year: number;
		units1: number;
		units2: number;
		units34: number;
		units5plus: number;
	}>;
	/** Summary of the two most-recent full annual periods, for the card. */
	permitsSummary: {
		latestYear: number;
		latestUnits5plus: number;
		priorYear: number | null;
		priorUnits5plus: number | null;
		yoyPctChange: number | null;
	} | null;
	/** Annual Census PEP population for the CBSA, ascending by year. */
	populationHistory: Array<{ year: number; population: number }>;
	/** Summary combining latest population + derived supply-vs-demand verdict. */
	populationSummary: {
		latestYear: number;
		latestPopulation: number;
		priorYear: number | null;
		priorPopulation: number | null;
		yoyPctChange: number | null;
		/** 5+ unit permits per 1,000 residents in `latestYear`, when both are present. */
		permitsPer1kLatest: number | null;
		supplyDemandVerdict:
			| 'supply-outpacing-demand'
			| 'balanced'
			| 'demand-outpacing-supply'
			| null;
	} | null;
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? sorted[mid]
		: Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export async function getZipInsight(zip: string): Promise<ZipInsight | null> {
	if (!/^\d{5}$/.test(zip)) return null;
	const db = assertDb();

	const zcRows = await db
		.select({ countyFips: zipCounty.countyFips, cbsaCode: zipCounty.cbsaCode })
		.from(zipCounty)
		.where(eq(zipCounty.zip, zip))
		.limit(1);
	if (zcRows.length === 0) return null;

	const countyFips = zcRows[0].countyFips;
	const cbsaCode = zcRows[0].cbsaCode;

	// Submissions by apt_type for the last 365 days.
	const subRows = await db
		.select({ aptType: submissions.aptType, rentCents: submissions.rentCents })
		.from(submissions)
		.where(eq(submissions.zip, zip));

	const submissionCount = subRows.length;
	const medianRentCentsByAptType = Object.fromEntries(
		APT_TYPES.map((t) => [t, null as number | null])
	) as Record<AptType, number | null>;
	const bucketed: Record<AptType, number[]> = Object.fromEntries(
		APT_TYPES.map((t) => [t, [] as number[]])
	) as Record<AptType, number[]>;
	for (const row of subRows) bucketed[row.aptType as AptType].push(row.rentCents);
	for (const t of APT_TYPES) medianRentCentsByAptType[t] = median(bucketed[t]);

	// Latest ACS median for the ZCTA.
	const acsRows = await db
		.select({ median: acsRent.medianGrossRentCents })
		.from(acsRent)
		.where(and(eq(acsRent.geoLevel, 'zcta'), eq(acsRent.geoId, zip)))
		.orderBy(desc(acsRent.year))
		.limit(1);
	const acsMedianGrossRentCents = acsRows[0]?.median ?? null;

	// Full HUD FMR history for this county, one query for all apt types + years.
	const hudFmrCentsByAptType = Object.fromEntries(
		APT_TYPES.map((t) => [t, null as number | null])
	) as Record<AptType, number | null>;
	const hudFmrHistoryByAptType = Object.fromEntries(
		APT_TYPES.map((t) => [t, [] as Array<{ year: number; cents: number }>])
	) as Record<AptType, Array<{ year: number; cents: number }>>;
	if (countyFips) {
		const histRows = await db
			.select({
				year: hudFmr.year,
				aptType: hudFmr.aptType,
				cents: hudFmr.fmrCents
			})
			.from(hudFmr)
			.where(eq(hudFmr.countyFips, countyFips))
			.orderBy(hudFmr.aptType, hudFmr.year);
		for (const row of histRows) {
			const t = row.aptType as AptType;
			if (!hudFmrHistoryByAptType[t]) continue;
			hudFmrHistoryByAptType[t].push({ year: row.year, cents: row.cents });
		}
		// Latest FMR per apt type = last point in the (year-sorted) series.
		for (const t of APT_TYPES) {
			const series = hudFmrHistoryByAptType[t];
			hudFmrCentsByAptType[t] = series.length > 0 ? series[series.length - 1].cents : null;
		}
	}

	// Full vacancy history for the CBSA, one query; derive "latest" from the tail.
	let latestVacancyPct: number | null = null;
	let latestVacancyPeriod: { year: number; quarter: number } | null = null;
	const vacancyHistory: Array<{ year: number; quarter: number; pct: number }> = [];
	if (cbsaCode) {
		const vacRows = await db
			.select({
				pct: vacancyRates.rentalVacancyPct,
				year: vacancyRates.year,
				quarter: vacancyRates.quarter
			})
			.from(vacancyRates)
			.where(eq(vacancyRates.cbsaCode, cbsaCode))
			.orderBy(vacancyRates.year, vacancyRates.quarter);
		for (const r of vacRows) {
			const pct = Number(r.pct);
			if (Number.isFinite(pct)) {
				vacancyHistory.push({ year: r.year, quarter: r.quarter, pct });
			}
		}
		if (vacancyHistory.length > 0) {
			const last = vacancyHistory[vacancyHistory.length - 1];
			latestVacancyPct = last.pct;
			latestVacancyPeriod = { year: last.year, quarter: last.quarter };
		}
	}

	// Building permits history (Census BPS, annual, by CBSA).
	const permitsHistory: Array<{
		year: number;
		units1: number;
		units2: number;
		units34: number;
		units5plus: number;
	}> = [];
	let permitsSummary: ZipInsight['permitsSummary'] = null;
	if (cbsaCode) {
		const permRows = await db
			.select({
				year: buildingPermits.year,
				month: buildingPermits.month,
				units1: buildingPermits.units1,
				units2: buildingPermits.units2,
				units34: buildingPermits.units34,
				units5plus: buildingPermits.units5plus
			})
			.from(buildingPermits)
			.where(eq(buildingPermits.cbsaCode, cbsaCode))
			.orderBy(buildingPermits.year, buildingPermits.month);

		// Prefer annual rows (month = 0); fall back to summing monthly rows.
		const byYear = new Map<
			number,
			{ units1: number; units2: number; units34: number; units5plus: number; hasAnnual: boolean }
		>();
		for (const r of permRows) {
			const prev = byYear.get(r.year) ?? {
				units1: 0,
				units2: 0,
				units34: 0,
				units5plus: 0,
				hasAnnual: false
			};
			if (r.month === 0) {
				byYear.set(r.year, {
					units1: r.units1,
					units2: r.units2,
					units34: r.units34,
					units5plus: r.units5plus,
					hasAnnual: true
				});
			} else if (!prev.hasAnnual) {
				prev.units1 += r.units1;
				prev.units2 += r.units2;
				prev.units34 += r.units34;
				prev.units5plus += r.units5plus;
				byYear.set(r.year, prev);
			}
		}
		for (const [year, v] of Array.from(byYear.entries()).sort((a, b) => a[0] - b[0])) {
			permitsHistory.push({
				year,
				units1: v.units1,
				units2: v.units2,
				units34: v.units34,
				units5plus: v.units5plus
			});
		}
		if (permitsHistory.length > 0) {
			const latest = permitsHistory[permitsHistory.length - 1];
			const prior = permitsHistory.length >= 2 ? permitsHistory[permitsHistory.length - 2] : null;
			const yoyPctChange =
				prior && prior.units5plus > 0
					? ((latest.units5plus - prior.units5plus) / prior.units5plus) * 100
					: null;
			permitsSummary = {
				latestYear: latest.year,
				latestUnits5plus: latest.units5plus,
				priorYear: prior?.year ?? null,
				priorUnits5plus: prior?.units5plus ?? null,
				yoyPctChange
			};
		}
	}

	// CBSA population history (Census PEP, annual).
	const populationHistory: Array<{ year: number; population: number }> = [];
	let populationSummary: ZipInsight['populationSummary'] = null;
	if (cbsaCode) {
		const popRows = await db
			.select({ year: cbsaPopulation.year, population: cbsaPopulation.population })
			.from(cbsaPopulation)
			.where(eq(cbsaPopulation.cbsaCode, cbsaCode))
			.orderBy(cbsaPopulation.year);
		for (const r of popRows) populationHistory.push({ year: r.year, population: r.population });

		if (populationHistory.length > 0) {
			const latest = populationHistory[populationHistory.length - 1];
			const prior =
				populationHistory.length >= 2
					? populationHistory[populationHistory.length - 2]
					: null;
			const popYoy =
				prior && prior.population > 0
					? ((latest.population - prior.population) / prior.population) * 100
					: null;

			// Permits/1k for the *same* year as the latest population datum, so the
			// ratio is internally consistent.
			const permitsLatestSameYear = permitsHistory.find((p) => p.year === latest.year);
			const permitsPer1kLatest =
				permitsLatestSameYear && latest.population > 0
					? (permitsLatestSameYear.units5plus / latest.population) * 1000
					: null;

			// Verdict: permits YoY vs population YoY.
			let supplyDemandVerdict:
				| 'supply-outpacing-demand'
				| 'balanced'
				| 'demand-outpacing-supply'
				| null = null;
			const permitsYoy = permitsSummary?.yoyPctChange ?? null;
			if (popYoy !== null && permitsYoy !== null) {
				const gap = permitsYoy - popYoy;
				if (gap >= SUPPLY_OUTPACING_PP) {
					supplyDemandVerdict = 'supply-outpacing-demand';
				} else if (
					gap <= DEMAND_OUTPACING_PP &&
					popYoy >= POPULATION_GROWTH_NOTABLE_PCT
				) {
					supplyDemandVerdict = 'demand-outpacing-supply';
				} else {
					supplyDemandVerdict = 'balanced';
				}
			}

			populationSummary = {
				latestYear: latest.year,
				latestPopulation: latest.population,
				priorYear: prior?.year ?? null,
				priorPopulation: prior?.population ?? null,
				yoyPctChange: popYoy,
				permitsPer1kLatest,
				supplyDemandVerdict
			};
		}
	}

	// Centroid (best-effort; null on failure).
	let lat: number | null = null;
	let lng: number | null = null;
	try {
		const cached = await db
			.select({ lat: zipCentroids.lat, lng: zipCentroids.lng })
			.from(zipCentroids)
			.where(eq(zipCentroids.zip, zip))
			.limit(1);
		if (cached.length > 0) {
			lat = Number(cached[0].lat);
			lng = Number(cached[0].lng);
		} else {
			const resolved = await resolveZipCentroid(zip);
			if (resolved) {
				lat = resolved.lat;
				lng = resolved.lng;
			}
		}
	} catch {
		// Centroid is a nice-to-have; data card still renders.
	}

	return {
		zip,
		countyFips,
		cbsaCode,
		lat,
		lng,
		submissionCount,
		medianRentCentsByAptType,
		acsMedianGrossRentCents,
		hudFmrCentsByAptType,
		hudFmrHistoryByAptType,
		latestVacancyPct,
		latestVacancyPeriod,
		vacancyHistory,
		permitsHistory,
		permitsSummary,
		populationHistory,
		populationSummary
	};
}
