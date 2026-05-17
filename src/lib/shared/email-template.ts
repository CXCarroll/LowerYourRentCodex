// Shared negotiation-email template engine.
//
// Templates are plain text with {{placeholder}} variables. This module is the
// single source of truth for which placeholders exist, plus the pure render
// helpers. It has NO server imports so it's safe to use both in the admin's
// live-preview UI and in the server-side email builder.

import type { AptType } from '$lib/shared/apt-types';

export interface TemplateVariable {
	/** Used in template bodies as {{key}}. */
	key: string;
	/** Human label shown in the admin variable-reference panel. */
	label: string;
	/** What the variable means + where its value comes from. */
	description: string;
	/** Realistic value used to drive the admin live preview. */
	sample: string;
}

// The catalog every template can draw from. Keep keys snake_case + lowercase.
export const VARIABLE_CATALOG: TemplateVariable[] = [
	{
		key: 'address',
		label: 'Address',
		description: 'Building address the tenant entered.',
		sample: '123 Main St, Brooklyn NY'
	},
	{
		key: 'apt_type',
		label: 'Apartment type',
		description: 'Studio / 1 BR / 2 BR / 3+ BR.',
		sample: '1 BR'
	},
	{
		key: 'zip',
		label: 'ZIP code',
		description: "Resolved from the tenant's address.",
		sample: '11201'
	},
	{
		key: 'current_rent',
		label: 'Current rent',
		description: 'Monthly rent the tenant pays now.',
		sample: '$2,500'
	},
	{
		key: 'proposed_rent',
		label: 'Proposed rent',
		description:
			'Primary ask — model-derived target rent (falls back to 12% below current when local data is thin).',
		sample: '$2,200'
	},
	{
		key: 'fallback_rent',
		label: 'Fallback rent',
		description:
			'Compromise figure — model walk-away rent (falls back to 7% below current when local data is thin).',
		sample: '$2,325'
	},
	{
		key: 'median_rent',
		label: 'Median rent',
		description: 'ACS median gross rent for the ZIP.',
		sample: '$2,275'
	},
	{
		key: 'pct_above_median',
		label: '% vs median',
		description:
			'How far current rent differs from the neighborhood median, as a non-negative whole number. Pair with {{median_direction}} so copy stays correct when rent is below market.',
		sample: '10'
	},
	{
		key: 'median_direction',
		label: 'Median direction',
		description:
			'Reads "above" or "below" — the direction that goes with {{pct_above_median}}.',
		sample: 'above'
	},
	{
		key: 'vacancy_rate',
		label: 'Vacancy rate',
		description: 'Latest rental vacancy % for the metro.',
		sample: '6.4'
	},
	{
		key: 'units_built_5yr',
		label: 'Units built (5 yr)',
		description: 'Multifamily (5+ unit) permits in the metro over the last 5 years.',
		sample: '12,400'
	},
	{
		key: 'fmr',
		label: 'HUD Fair Market Rent',
		description: 'HUD Fair Market Rent for the apartment type + county.',
		sample: '$2,150'
	}
];

const VALID_KEYS = new Set(VARIABLE_CATALOG.map((v) => v.key));

// Matches {{key}} with optional inner whitespace. Keys are alphanumeric +
// underscore. Note the literal [Landlord name] / [Your name] markers use
// SINGLE brackets and are deliberately NOT matched — they pass through for
// the tenant to fill in their own mail client.
const PLACEHOLDER_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

/**
 * Replace every {{key}} in `body` with `values[key]`. Unknown keys (no entry
 * in `values`) are left intact so a misspelled placeholder is visible rather
 * than silently dropped.
 */
export function renderTemplate(body: string, values: Record<string, string>): string {
	return body.replace(PLACEHOLDER_RE, (match, rawKey: string) => {
		const key = rawKey.toLowerCase();
		return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
	});
}

/** Distinct {{placeholders}} in `body` that are not in the catalog. */
export function findUnknownPlaceholders(body: string): string[] {
	const found = new Set<string>();
	for (const m of body.matchAll(PLACEHOLDER_RE)) {
		const key = m[1].toLowerCase();
		if (!VALID_KEYS.has(key)) found.add(key);
	}
	return [...found];
}

/** Sample values keyed by variable — drives the admin live preview. */
export function sampleValues(): Record<string, string> {
	return Object.fromEntries(VARIABLE_CATALOG.map((v) => [v.key, v.sample]));
}

// ── Template audience ──────────────────────────────────────────────────────
// A template's intended recipient. `above_median` / `below_median` templates
// are only served when the tenant's rent is above / below the neighborhood
// median; `any` templates serve everyone.

export type TemplateAudience = 'any' | 'above_median' | 'below_median';

// Keep in sync with the emailTemplateAudience pgEnum in
// src/lib/server/db/schema.ts.
export const AUDIENCE_VALUES = ['any', 'above_median', 'below_median'] as const;

/** Human labels for the admin audience selector + list badge. */
export const AUDIENCE_LABELS: Record<TemplateAudience, string> = {
	any: 'Any tenant',
	above_median: 'Above-market tenants',
	below_median: 'Below-market tenants'
};

/** Type guard for an untrusted audience value (e.g. submitted form data). */
export function isAudience(v: unknown): v is TemplateAudience {
	return typeof v === 'string' && (AUDIENCE_VALUES as readonly string[]).includes(v);
}

/** Map a `compareToMedian` direction to the template audience it targets. */
export function audienceForDirection(direction: 'above' | 'below'): TemplateAudience {
	return direction === 'below' ? 'below_median' : 'above_median';
}

// ── Template aggressiveness ────────────────────────────────────────────────
// The tone scale behind the tenant-facing toggle. Each tier maps to a fixed
// Version slot: baseline → Version 1, more_aggressive → Version 2,
// very_aggressive → Version 3.

export type TemplateAggressiveness = 'baseline' | 'more_aggressive' | 'very_aggressive';

// Keep in sync with the emailTemplateAggressiveness pgEnum in
// src/lib/server/db/schema.ts. ORDER IS LOAD-BEARING: index 0/1/2 is the
// template tier for Version 1/2/3 in the tenant-facing toggle.
export const AGGRESSIVENESS_VALUES = ['baseline', 'more_aggressive', 'very_aggressive'] as const;

/** Human labels for the admin aggressiveness selector + list badge. */
export const AGGRESSIVENESS_LABELS: Record<TemplateAggressiveness, string> = {
	baseline: 'Baseline',
	more_aggressive: 'More aggressive',
	very_aggressive: 'Very aggressive'
};

/** Type guard for an untrusted aggressiveness value (e.g. submitted form data). */
export function isAggressiveness(v: unknown): v is TemplateAggressiveness {
	return typeof v === 'string' && (AGGRESSIVENESS_VALUES as readonly string[]).includes(v);
}

// ── Per-version rent reduction ─────────────────────────────────────────────
// Each version asks for a fraction of the algorithm's full recommended
// reduction. The fraction is keyed off the aggressiveness tier, so the
// tenant-facing toggle escalates baseline → very (smallest → largest ask).

/** One rendered negotiation-email variation + its headline monthly reduction. */
export interface NegotiationVersion {
	body: string;
	/** Monthly rent reduction this version asks for, in cents. */
	reductionCents: number;
}

/** Share of the full recommended reduction each tier asks for (0..1). */
export const AGGRESSIVENESS_REDUCTION_FRACTION: Record<TemplateAggressiveness, number> = {
	baseline: 0.5,
	more_aggressive: 0.75,
	very_aggressive: 1
};

/** Round a cents amount to the nearest whole $50. */
function roundTo50(cents: number): number {
	return Math.round(cents / 5000) * 5000;
}

/**
 * Scale the algorithm's full recommendation down to one tier's share.
 * `fraction` is 0..1 of the full reduction. Returns the tier's rounded
 * proposed + fallback rents and the headline monthly reduction (all cents).
 * Reductions round to the nearest $50 so the three toggle labels stay distinct.
 */
export function tierProposal(
	currentCents: number,
	fullProposedCents: number,
	fullFallbackCents: number,
	fraction: number
): { proposedCents: number; fallbackCents: number; reductionCents: number } {
	const reductionCents = roundTo50(fraction * (currentCents - fullProposedCents));
	const fallbackReductionCents = roundTo50(fraction * (currentCents - fullFallbackCents));
	return {
		proposedCents: currentCents - reductionCents,
		fallbackCents: currentCents - fallbackReductionCents,
		reductionCents
	};
}

/**
 * Sample values for the admin live preview, adjusted so the copy reads
 * sensibly for the chosen audience — a below-market template should preview
 * with median_direction="below" so the admin sees realistic wording.
 */
export function sampleValuesForAudience(audience: TemplateAudience): Record<string, string> {
	const base = sampleValues();
	if (audience === 'below_median') {
		return { ...base, median_direction: 'below', pct_above_median: '12' };
	}
	return base;
}

/** Apartment-type → short label used inside email copy (e.g. "1 BR"). */
export const APT_EMAIL_LABEL: Record<AptType, string> = {
	studio: 'studio',
	'1br': '1 BR',
	'2br': '2 BR',
	'3br': '3+ BR',
	'4br_plus': '3+ BR'
};

/** Format a cents amount as a whole-dollar USD string, e.g. 250000 → "$2,500". */
export function formatDollars(cents: number): string {
	const dollars = Math.round(cents / 100);
	return dollars.toLocaleString('en-US', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 0,
		maximumFractionDigits: 0
	});
}

/**
 * Compare current rent to the neighborhood median. Returns the gap as a
 * non-negative whole percentage plus the direction word, so callers can build
 * sign-correct copy ("{{pct}}% {{direction}} the median") instead of emitting a
 * negative number followed by the word "above". Direction is keyed off the
 * rounded gap, so a sub-1% difference reads as "0% above" rather than the odd
 * "0% below". An unknown median (<= 0) reports a 0% gap.
 */
export function compareToMedian(
	currentCents: number,
	medianCents: number
): { pct: number; direction: 'above' | 'below' } {
	if (medianCents <= 0) return { pct: 0, direction: 'above' };
	const pctSigned = Math.round(((currentCents - medianCents) / medianCents) * 100);
	return { pct: Math.abs(pctSigned), direction: pctSigned < 0 ? 'below' : 'above' };
}
