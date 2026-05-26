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
		description: 'Local ACS rent benchmark used by the proposal.',
		sample: '$2,275'
	},
	{
		key: 'acs_rent_description',
		label: 'ACS rent description',
		description:
			'Source-aware text describing whether the ACS benchmark is PUMS recent-mover or aggregate ZCTA rent.',
		sample: 'ACS recent-mover market rent for this local area'
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
		description:
			'Raw count of new multifamily (5+ unit) apartments built in the metro over the last 5 years. Empty when the metro has no data — prefer {{supply_context}} for a guarded, ready-made sentence.',
		sample: '12,400'
	},
	{
		key: 'supply_context',
		label: 'New-supply sentence',
		description:
			'Ready-made sentence about recent apartment construction in the metro. Empty when the metro has too little new supply to help the tenant, so it can sit on its own paragraph and vanish cleanly.',
		sample:
			'Public housing data also shows that over 12,000 new apartment units have been built across this metro area between 2019 and 2023 — a meaningful addition to local rental supply that gives tenants more options.'
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
 *
 * Blank-line runs of 3+ newlines are collapsed to a single blank line, so a
 * placeholder that resolves to '' (e.g. {{supply_context}} for a metro with no
 * data) can sit on its own paragraph and disappear without leaving a gap.
 */
export function renderTemplate(body: string, values: Record<string, string>): string {
	const rendered = body.replace(PLACEHOLDER_RE, (match, rawKey: string) => {
		const key = rawKey.toLowerCase();
		return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
	});
	return rendered.replace(/\n{3,}/g, '\n\n').trim();
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

// ── New-supply context ─────────────────────────────────────────────────────
// A negotiation point: lots of recent apartment construction signals a
// softening market. The figure comes from the Census Building Permits Survey
// (5+ unit permits, summed over the metro's last ~5 years).

/**
 * Minimum 5-year 5+-unit count for the supply line to appear. Below this a
 * metro's recent construction is too thin to help the tenant — and a small
 * number arguably signals *tight* supply, which would undercut their case.
 */
export const MIN_UNITS_FOR_SUPPLY_LINE = 1000;

/**
 * Round `n` *down* to a clean figure — nearest 500 below 10,000, nearest 1,000
 * at or above. Rounding down keeps "over {n}" a true lower bound on the real
 * count, so the claim is always conservative.
 */
export function roundDownToNice(n: number): number {
	if (n < 10000) return Math.floor(n / 500) * 500;
	return Math.floor(n / 1000) * 1000;
}

/**
 * Pre-composed "new supply" sentence for the negotiation email. Returns a
 * complete sentence when the metro has a meaningful amount of recent
 * multifamily construction, or '' when data is missing or too thin to help the
 * tenant. The count is rounded down so "over {n}" is always conservative, and
 * the actual year range is cited so the claim is verifiable.
 */
export function supplyContextSentence(
	units5plus: number | null,
	firstYear: number | null,
	lastYear: number | null
): string {
	if (units5plus == null || firstYear == null || lastYear == null) return '';
	if (units5plus < MIN_UNITS_FOR_SUPPLY_LINE) return '';
	const rounded = roundDownToNice(units5plus);
	if (rounded < MIN_UNITS_FOR_SUPPLY_LINE) return '';
	const count = rounded.toLocaleString('en-US');
	const span =
		firstYear === lastYear ? `in ${firstYear}` : `between ${firstYear} and ${lastYear}`;
	return `Public housing data also shows that over ${count} new apartment units have been built across this metro area ${span} — a meaningful addition to local rental supply that gives tenants more options.`;
}
