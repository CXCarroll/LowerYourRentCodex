// DB-backed proposal orchestration. Pure math lives in proposal-math.ts.

import type { Proposal } from '$lib/shared/types';
import type { AptType } from '$lib/shared/apt-types';
import {
	buildDistribution,
	computeTiers,
	labelConfidence,
	vacancyAdjustment
} from './proposal-math';
import { recommendCounteroffer } from './nvr-math';
import {
	loadNegotiationMarketData,
	type NegotiationMarketData
} from './negotiation-market-data';

export interface ProposalInput {
	currentRentCents: number;
	aptType: AptType;
	zip: string;
	countyFips: string | null;
	cbsaCode: string | null;
}

export interface ProposalMarketInput {
	currentRentCents: number;
	marketData: NegotiationMarketData;
}

export function computeProposalFromMarketData({
	currentRentCents,
	marketData
}: ProposalMarketInput): Proposal | null {
	const dist = buildDistribution({
		userComps: marketData.userComps,
		acsMedianCents: marketData.acsMedianCents,
		fmrCents: marketData.fmrCents
	});
	if (!dist) return null;

	const adjustment = vacancyAdjustment(marketData.latestVacancyPct);
	const tiers = computeTiers(dist, adjustment, currentRentCents);

	// Independent second opinion from the Natural-Vacancy-Rate model. Reuses
	// the vacancyPct we already fetched above; returns null when unavailable.
	const nvr = recommendCounteroffer({
		currentRentCents,
		vacancyPct: marketData.latestVacancyPct
	});

	return {
		currentCents: currentRentCents,
		targetCents: tiers.targetCents,
		lowCents: tiers.lowCents,
		walkAwayCents: tiers.walkAwayCents,
		sampleSize: marketData.userComps.length,
		confidence: labelConfidence(dist.source, marketData.userComps.length),
		source: dist.source,
		fmrCents: marketData.fmrCents,
		acsMedianCents: marketData.acsMedianCents,
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

export async function computeProposal(input: ProposalInput): Promise<Proposal | null> {
	const marketData = await loadNegotiationMarketData({
		zip: input.zip,
		aptType: input.aptType
	});
	if (!marketData) return null;
	return computeProposalFromMarketData({
		currentRentCents: input.currentRentCents,
		marketData: {
			...marketData,
			countyFips: input.countyFips,
			cbsaCode: input.cbsaCode
		}
	});
}
