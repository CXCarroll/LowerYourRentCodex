// DB-backed proposal orchestration. Pure math lives in proposal-math.ts.

import { and, eq, gt, sql, desc } from 'drizzle-orm';
import { assertDb } from './db/client';
import { submissions, hudFmr, acsRent, vacancyRates } from './db/schema';
import type { Proposal } from '$lib/shared/types';
import type { AptType } from '$lib/shared/apt-types';
import {
	buildDistribution,
	computeTiers,
	labelConfidence,
	vacancyAdjustment
} from './proposal-math';
import { recommendCounteroffer } from './nvr-math';

export interface ProposalInput {
	currentRentCents: number;
	aptType: AptType;
	zip: string;
	countyFips: string | null;
	cbsaCode: string | null;
}

export async function computeProposal(input: ProposalInput): Promise<Proposal | null> {
	const db = assertDb();

	const userRows = await db
		.select({ rentCents: submissions.rentCents })
		.from(submissions)
		.where(
			and(
				eq(submissions.zip, input.zip),
				eq(submissions.aptType, input.aptType),
				gt(submissions.createdAt, sql`now() - interval '365 days'`)
			)
		);
	const userComps = userRows.map((r) => r.rentCents);

	let fmrCents: number | null = null;
	if (input.countyFips) {
		const fmrRows = await db
			.select({ fmrCents: hudFmr.fmrCents })
			.from(hudFmr)
			.where(and(eq(hudFmr.countyFips, input.countyFips), eq(hudFmr.aptType, input.aptType)))
			.orderBy(desc(hudFmr.year))
			.limit(1);
		if (fmrRows.length > 0) fmrCents = fmrRows[0].fmrCents;
	}

	const acsRows = await db
		.select({ median: acsRent.medianGrossRentCents })
		.from(acsRent)
		.where(and(eq(acsRent.geoLevel, 'zcta'), eq(acsRent.geoId, input.zip)))
		.orderBy(desc(acsRent.year))
		.limit(1);
	const acsMedianCents = acsRows[0]?.median ?? null;

	let vacancyPct: number | null = null;
	if (input.cbsaCode) {
		const vacRows = await db
			.select({ pct: vacancyRates.rentalVacancyPct })
			.from(vacancyRates)
			.where(eq(vacancyRates.cbsaCode, input.cbsaCode))
			.orderBy(desc(vacancyRates.year), desc(vacancyRates.quarter))
			.limit(1);
		if (vacRows.length > 0) vacancyPct = Number(vacRows[0].pct);
	}

	const dist = buildDistribution({ userComps, acsMedianCents, fmrCents });
	if (!dist) return null;

	const adjustment = vacancyAdjustment(vacancyPct);
	const tiers = computeTiers(dist, adjustment, input.currentRentCents);

	// Independent second opinion from the Natural-Vacancy-Rate model. Reuses
	// the vacancyPct we already fetched above; returns null when unavailable.
	const nvr = recommendCounteroffer({
		currentRentCents: input.currentRentCents,
		vacancyPct
	});

	return {
		currentCents: input.currentRentCents,
		targetCents: tiers.targetCents,
		lowCents: tiers.lowCents,
		walkAwayCents: tiers.walkAwayCents,
		sampleSize: userComps.length,
		confidence: labelConfidence(dist.source, userComps.length),
		source: dist.source,
		fmrCents,
		acsMedianCents,
		nvrCounteroffer: nvr
			? {
					counterofferCents: nvr.counterofferRentCents,
					regime: nvr.regime,
					spotDiscount: nvr.spotDiscount,
					vacancyPct: nvr.vacancy * 100
				}
			: null
	};
}
