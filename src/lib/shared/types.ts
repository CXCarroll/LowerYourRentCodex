export type Confidence = 'very_low' | 'low' | 'medium' | 'high';

export interface Proposal {
	lowCents: number;
	targetCents: number;
	walkAwayCents: number;
	currentCents: number;
	sampleSize: number;
	confidence: Confidence;
	source: 'user_data' | 'blended' | 'fmr_fallback';
	/** Raw HUD Fair Market Rent used as one of the comparables. Null if unavailable. */
	fmrCents: number | null;
	/** Census rent input used by proposal math. Null if unavailable. */
	acsMedianCents: number | null;
	/** Distinguishes PUMS recent-mover market rent from aggregate ZCTA ACS rent. */
	acsSource: 'pums_recent_mover' | 'acs_aggregate' | null;
	/**
	 * Independent Natural-Vacancy-Rate counteroffer (see nvr-math.ts).
	 * Uses only the metro vacancy rate and a regime-switching economic model.
	 * Null when vacancy is unavailable for the tenant's CBSA.
	 */
	nvrCounteroffer?: {
		counterofferCents: number;
		regime: 'linear' | 'asymmetric' | 'quadratic';
		/** Raw spot-market discount, decimal 0..0.22 (pre-retention split). */
		spotDiscount: number;
		/** Vacancy used, as a percent (e.g. 8.0). */
		vacancyPct: number;
	} | null;
}

export interface EmailTemplate {
	subject: string;
	body: string;
}

export interface ApiError {
	error: string;
	message: string;
	retryAfter?: number;
}
