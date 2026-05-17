// Pure proposal math. No DB, no SvelteKit imports — unit-testable in isolation.

import type { Confidence } from '$lib/shared/types';

export interface DistributionInput {
	userComps: number[]; // rent cents
	acsMedianCents: number | null;
	fmrCents: number | null;
}

export interface Distribution {
	median: number;
	p25: number;
	p75: number;
	source: 'user_data' | 'blended' | 'fmr_fallback';
}

export function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) throw new Error('percentile of empty array');
	if (sorted.length === 1) return sorted[0];
	const rank = (p / 100) * (sorted.length - 1);
	const lo = Math.floor(rank);
	const hi = Math.ceil(rank);
	if (lo === hi) return sorted[lo];
	const frac = rank - lo;
	return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

export function buildDistribution(input: DistributionInput): Distribution | null {
	const { userComps, acsMedianCents, fmrCents } = input;
	const n = userComps.length;
	const sorted = [...userComps].sort((a, b) => a - b);

	if (n >= 8) {
		return {
			median: percentile(sorted, 50),
			p25: percentile(sorted, 25),
			p75: percentile(sorted, 75),
			source: 'user_data'
		};
	}
	if (n >= 3 && acsMedianCents !== null) {
		const wUser = n / (n + 8);
		const wAcs = 1 - wUser;
		const userMed = percentile(sorted, 50);
		const userP25 = percentile(sorted, 25);
		const userP75 = percentile(sorted, 75);
		return {
			median: wUser * userMed + wAcs * acsMedianCents,
			p25: wUser * userP25 + wAcs * (acsMedianCents * 0.85),
			p75: wUser * userP75 + wAcs * (acsMedianCents * 1.15),
			source: 'blended'
		};
	}
	if (fmrCents !== null) {
		return {
			median: fmrCents,
			p25: fmrCents * 0.85,
			p75: fmrCents * 1.15,
			source: 'fmr_fallback'
		};
	}
	if (acsMedianCents !== null) {
		return {
			median: acsMedianCents,
			p25: acsMedianCents * 0.85,
			p75: acsMedianCents * 1.15,
			source: 'fmr_fallback'
		};
	}
	return null;
}

export function vacancyAdjustment(vacancyPct: number | null): number {
	const v = vacancyPct ?? 6.0;
	const raw = 1 - Math.max(0, v - 6.0) * 0.005;
	return Math.min(1.0, Math.max(0.92, raw));
}

export interface Tiers {
	targetCents: number;
	lowCents: number;
	walkAwayCents: number;
}

export function computeTiers(
	dist: Distribution,
	adjustment: number,
	currentRentCents: number
): Tiers {
	let target = Math.round(dist.median * adjustment);
	let low = Math.round(Math.min(dist.p25 * adjustment, currentRentCents * 0.85));
	let walkAway = Math.round(Math.min(target * 1.02, currentRentCents * 0.97));

	// Never propose an increase.
	target = Math.min(target, currentRentCents);
	low = Math.min(low, Math.round(currentRentCents * 0.97));
	walkAway = Math.min(walkAway, currentRentCents);

	// Enforce ordering: low <= target <= walkAway <= current
	if (low > target) low = target;
	if (walkAway < target) walkAway = target;

	return { targetCents: target, lowCents: low, walkAwayCents: walkAway };
}

export function labelConfidence(source: Distribution['source'], n: number): Confidence {
	if (source === 'user_data' && n >= 20) return 'high';
	if (source === 'user_data' || n >= 8) return 'medium';
	if (source === 'blended') return 'low';
	return 'very_low';
}
