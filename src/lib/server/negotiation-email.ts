// Builds the negotiation-email variations served to a tenant after they
// finish the form. Resolves real market data for their address, fills the
// admin's template placeholders, and returns one variant per aggressiveness
// tier — each asking for a different share of the recommended reduction.
//
// Designed to NEVER throw: geocode misses, DB outages, and an empty template
// table all degrade to documented demo fallbacks so the public flow can't
// break.

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/client';
import { emailTemplates } from '$lib/server/db/schema';
import { getZipInsight } from '$lib/server/admin/zip-explorer';
import { geocodeAddressToZip } from '$lib/server/geocode';
import { computeProposal } from '$lib/server/proposal';
import type { AptType } from '$lib/shared/apt-types';
import {
	AGGRESSIVENESS_REDUCTION_FRACTION,
	AGGRESSIVENESS_VALUES,
	APT_EMAIL_LABEL,
	audienceForDirection,
	compareToMedian,
	formatDollars,
	renderTemplate,
	supplyContextSentence,
	tierProposal,
	type NegotiationVersion
} from '$lib/shared/email-template';

// Built-in fallback — the original V1 copy, templatized. Used when the
// email_templates table is empty or the DB is unreachable.
export const DEFAULT_TEMPLATE_BODY = `Hi [Landlord name],

I hope you're doing well. My lease at {{address}} is up for renewal soon, and I wanted to open a conversation about the renewal rate.

After reviewing local data — including HUD Fair Market Rent figures and the American Community Survey's median rent for comparable {{apt_type}} units in this ZIP — my current rent of {{current_rent}} appears to be about {{pct_above_median}}% {{median_direction}} the neighborhood median of {{median_rent}}.

{{supply_context}}

I'd like to propose renewing at {{proposed_rent}}/month. I've been a reliable tenant, always paid on time, and I'd prefer to renew rather than move. If that's not workable, I could make {{fallback_rent}} work on a 12-month renewal.

Happy to hop on a quick call. Thanks for considering.

— [Your name]`;

interface BuildInput {
	address: string;
	aptType: AptType;
	/** Raw rent value from the form, e.g. "2,500" or "2500". Punctuation tolerated. */
	rent: string;
}

// Demo fallback used when real vacancy data is unavailable for a metro.
const FALLBACK_VACANCY_PCT = 6.0;

/** Round a cents amount to the nearest whole $100, mirroring the legacy math. */
function roundTo100(cents: number): number {
	return Math.round(cents / 100) * 100;
}

export async function buildNegotiationEmail(
	{ address, aptType, rent }: BuildInput,
	fetchFn: typeof fetch
): Promise<{ versions: NegotiationVersion[] }> {
	// ── 1. Rent-derived figures (always available, never throw) ──────────────
	const r = parseInt((rent || '').replace(/\D/g, ''), 10) || 2500;
	const currentCents = r * 100;
	// Flat-percentage defaults. Overridden below by the data-driven proposal
	// when the address resolves to a ZIP with usable market data.
	let proposedCents = roundTo100(currentCents * 0.88);
	let fallbackCents = roundTo100(currentCents * 0.93);

	// ── 2. Resolve location + market data (best-effort) ──────────────────────
	let zip: string | null = null;
	let medianCents = roundTo100(currentCents * 0.91);
	let vacancyPct = FALLBACK_VACANCY_PCT;
	let fmrCents = roundTo100(currentCents * 0.95);
	// Real metro construction figures — left null when the address doesn't
	// resolve to a metro with permit data, so the email omits the supply line
	// rather than printing a fabricated number.
	let units5yr: number | null = null;
	let permitsFirstYear: number | null = null;
	let permitsLastYear: number | null = null;

	try {
		zip = await geocodeAddressToZip(address, fetchFn);
		if (zip) {
			const insight = await getZipInsight(zip);
			if (insight) {
				if (insight.acsMedianGrossRentCents != null) {
					medianCents = insight.acsMedianGrossRentCents;
				}
				if (insight.latestVacancyPct != null) {
					vacancyPct = insight.latestVacancyPct;
				}
				const fmr = insight.hudFmrCentsByAptType[aptType];
				if (fmr != null) fmrCents = fmr;
				if (insight.permitsHistory.length > 0) {
					const recent = insight.permitsHistory.slice(-5);
					units5yr = recent.reduce((sum, p) => sum + p.units5plus, 0);
					permitsFirstYear = recent[0].year;
					permitsLastYear = recent[recent.length - 1].year;
				}

				// Data-driven proposal: percentile distribution of recent
				// comps, blended with ACS/FMR and adjusted for metro vacancy.
				// Reuses the county + CBSA getZipInsight already resolved.
				// Adopt it only when it actually beats the current rent — the
				// model caps its target at current rent, and an email that
				// "proposes" the rent already paid is useless.
				const proposal = await computeProposal({
					currentRentCents: currentCents,
					aptType,
					zip,
					countyFips: insight.countyFips,
					cbsaCode: insight.cbsaCode
				});
				if (proposal && proposal.targetCents < currentCents) {
					proposedCents = proposal.targetCents;
					fallbackCents = proposal.walkAwayCents;
				}
			}
		}
	} catch {
		// Geocode / market lookup failed — keep the rent-derived fallbacks.
	}

	// Non-negative gap + direction word — keeps copy sensible when the tenant's
	// rent is *below* the median (avoids "-49% above the median").
	const { pct: pctAboveMedian, direction: medianDirection } = compareToMedian(
		currentCents,
		medianCents
	);

	// ── 3. Shared variable map ────────────────────────────────────────────────
	// Everything except `proposed_rent` / `fallback_rent`, which vary per
	// version (each version asks for a different share of the reduction).
	const baseValues: Record<string, string> = {
		address: address?.trim() || '[your address]',
		apt_type: APT_EMAIL_LABEL[aptType] ?? '1 BR',
		zip: zip ?? '',
		current_rent: formatDollars(currentCents),
		median_rent: formatDollars(medianCents),
		pct_above_median: String(pctAboveMedian),
		median_direction: medianDirection,
		vacancy_rate: vacancyPct.toFixed(1),
		units_built_5yr: units5yr != null ? units5yr.toLocaleString('en-US') : '',
		supply_context: supplyContextSentence(units5yr, permitsFirstYear, permitsLastYear),
		fmr: formatDollars(fmrCents)
	};

	// ── 4. Pick one random active template per aggressiveness tier ───────────
	// Each Version maps to a fixed tier: V1 = baseline, V2 = more_aggressive,
	// V3 = very_aggressive. Within a tier an audience-specific template beats a
	// generic `any` one, then random. A tier with no active template falls back
	// to the built-in default so the toggle always shows all 3 versions. If the
	// whole table is empty (or the DB is down) we drop to a single default body
	// and the picker stays hidden.
	let templateBodies: string[] = [];
	try {
		if (db) {
			const matchAudience = audienceForDirection(medianDirection);
			const rows = await db
				.selectDistinctOn([emailTemplates.aggressiveness], {
					aggressiveness: emailTemplates.aggressiveness,
					body: emailTemplates.body
				})
				.from(emailTemplates)
				.where(
					and(
						eq(emailTemplates.status, 'active'),
						inArray(emailTemplates.audience, ['any', matchAudience])
					)
				)
				.orderBy(
					emailTemplates.aggressiveness,
					sql`(${emailTemplates.audience} = 'any')`,
					sql`random()`
				);
			if (rows.length > 0) {
				const byTier = new Map(rows.map((row) => [row.aggressiveness, row.body]));
				templateBodies = AGGRESSIVENESS_VALUES.map(
					(tier) => byTier.get(tier) ?? DEFAULT_TEMPLATE_BODY
				);
			}
		}
	} catch {
		// DB unreachable — fall through to the built-in default.
	}
	if (templateBodies.length === 0) {
		templateBodies = [DEFAULT_TEMPLATE_BODY];
	}

	// ── 5. Scale + render each variation ─────────────────────────────────────
	// `proposedCents` / `fallbackCents` hold the algorithm's full recommended
	// reduction. Each version asks for a tier-specific fraction of it, so the
	// rendered copy and the toggle label match the version the tenant picked.
	function renderVersion(body: string, fraction: number): NegotiationVersion {
		const scaled = tierProposal(currentCents, proposedCents, fallbackCents, fraction);
		const values = {
			...baseValues,
			proposed_rent: formatDollars(scaled.proposedCents),
			fallback_rent: formatDollars(scaled.fallbackCents)
		};
		return { body: renderTemplate(body, values), reductionCents: scaled.reductionCents };
	}

	if (templateBodies.length === AGGRESSIVENESS_VALUES.length) {
		return {
			versions: templateBodies.map((body, i) =>
				renderVersion(body, AGGRESSIVENESS_REDUCTION_FRACTION[AGGRESSIVENESS_VALUES[i]])
			)
		};
	}
	// Single built-in default fallback — render at the full recommendation.
	return { versions: [renderVersion(templateBodies[0], 1)] };
}
