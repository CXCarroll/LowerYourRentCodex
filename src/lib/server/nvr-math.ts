/**
 * Natural Vacancy Rate (NVR) rent-negotiation math.
 *
 * Ported from the user-authored draft at ~/Downloads/rent-negotiation.ts, with
 * these adaptations for this codebase:
 *   - API boundary works in cents (integers) like proposal-math.ts.
 *   - Takes vacancy as a percent (e.g. 8.0 for 8%), matching how
 *     `vacancy_rates.rental_vacancy_pct` is stored; converts to decimal
 *     internally.
 *   - Returns null when vacancy is null so the caller can hide the block.
 *
 * Core idea:
 *   1. Predict aggregate rent change (ΔR) from V_t vs. V*, using the model
 *      appropriate to the regime (linear / asymmetric / quadratic).
 *   2. Convert aggregate ΔR to a SPOT-MARKET discount by dividing by turnover.
 *   3. Landlord keeps `retentionShare` of that discount as turnover-avoidance
 *      savings; tenant captures the remainder.
 *
 * Pure module — no DB, no SvelteKit imports, fully unit-testable.
 */
export type Regime = 'linear' | 'asymmetric' | 'quadratic';

export const DEFAULTS = {
	// National equilibrium multifamily vacancy (5–7%); 6% midpoint.
	naturalVacancyRate: 0.06,

	// Standard rent-adjustment speed (0.10–0.50 in the literature).
	adjustmentFactor: 0.3,

	// Typical U.S. apartment turnover rate.
	turnoverRate: 0.5,

	// Landlord share of the spot discount (turnover-avoidance value).
	// Tenant captures (1 − share).
	retentionShare: 0.2,

	// Regime thresholds, as V_t − V* (decimal percentage points).
	elevatedGap: 0.02,
	shockGap: 0.04,

	// Asymmetric-regime adjustment speed: once vacancy is clearly above V*
	// landlords react faster than the stable-market λ.
	lambdaElevated: 0.6,

	// Quadratic coefficients for ΔR = α − β₁V_t − β₂V_t²
	// α is derived from V* so ΔR(V*) = 0 (continuity with linear at equilibrium).
	quadBeta1: 0.3,
	quadBeta2: 4.0,

	// Safety rails on final spot-market discount.
	maxDiscount: 0.22,
	minDiscount: 0.0
} as const;

/** Pick the right model based on how far vacancy sits above the natural rate. */
export function selectRegime(vacancyGap: number): Regime {
	if (vacancyGap >= DEFAULTS.shockGap) return 'quadratic';
	if (vacancyGap >= DEFAULTS.elevatedGap) return 'asymmetric';
	return 'linear';
}

function linearDeltaR(vStar: number, vT: number, lambda: number): number {
	return lambda * (vStar - vT);
}

function asymmetricDeltaR(vStar: number, vT: number): number {
	return DEFAULTS.lambdaElevated * (vStar - vT);
}

function quadraticDeltaR(vStar: number, vT: number): number {
	const { quadBeta1, quadBeta2 } = DEFAULTS;
	const alpha = quadBeta1 * vStar + quadBeta2 * vStar * vStar;
	return alpha - quadBeta1 * vT - quadBeta2 * vT * vT;
}

export function predictAggregateDeltaR(
	regime: Regime,
	vStar: number,
	vT: number,
	lambda: number
): number {
	switch (regime) {
		case 'linear':
			return linearDeltaR(vStar, vT, lambda);
		case 'asymmetric':
			return asymmetricDeltaR(vStar, vT);
		case 'quadratic':
			return quadraticDeltaR(vStar, vT);
	}
}

export interface NvrInput {
	/** Tenant's current monthly rent, in cents. */
	currentRentCents: number;
	/** Market vacancy as percent (e.g. 8.0 for 8%). Null ⇒ no recommendation. */
	vacancyPct: number | null;
	/** Per-CBSA turnover override (decimal). Defaults to 0.50. */
	turnoverRate?: number;
}

export interface NvrResult {
	/** Recommended counteroffer in cents, rounded to the cent. */
	counterofferRentCents: number;
	/** Which regime the model selected. */
	regime: Regime;
	/**
	 * The spot-market discount implied by the model, as a decimal (0..0.22).
	 * This is the RAW spot correction before the landlord's retention share
	 * is split out — i.e. what a fresh lease would drop by in aggregate.
	 */
	spotDiscount: number;
	/** The vacancy value used (decimal, e.g. 0.08). */
	vacancy: number;
}

/**
 * Compute the NVR counteroffer. Returns null when vacancy is unavailable so
 * the caller can hide the UI block gracefully.
 */
export function recommendCounteroffer(input: NvrInput): NvrResult | null {
	if (input.vacancyPct === null || !Number.isFinite(input.vacancyPct)) {
		return null;
	}

	const vT = input.vacancyPct / 100;
	const vStar = DEFAULTS.naturalVacancyRate;
	const lambda = DEFAULTS.adjustmentFactor;
	const turnoverRate = input.turnoverRate ?? DEFAULTS.turnoverRate;
	const retentionShare = DEFAULTS.retentionShare;

	const regime = selectRegime(vT - vStar);
	const aggregateDeltaR = predictAggregateDeltaR(regime, vStar, vT, lambda);

	// Only the fraction of units that turn over absorbs the full correction,
	// so spot swing = aggregate ÷ turnover. Ignore positive ΔR (rising market
	// ⇒ no tenant-facing discount).
	const rawSpotDelta = aggregateDeltaR < 0 ? aggregateDeltaR / turnoverRate : 0;

	const spotDiscount = Math.min(
		DEFAULTS.maxDiscount,
		Math.max(DEFAULTS.minDiscount, Math.abs(rawSpotDelta))
	);

	// Landlord keeps `retentionShare`; tenant captures the rest.
	const effectiveDiscount = spotDiscount * (1 - retentionShare);
	const counterofferRentCents = Math.round(input.currentRentCents * (1 - effectiveDiscount));

	return {
		counterofferRentCents,
		regime,
		spotDiscount,
		vacancy: vT
	};
}
