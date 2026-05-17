import { describe, expect, test } from 'bun:test';
import {
	renderTemplate,
	findUnknownPlaceholders,
	formatDollars,
	compareToMedian,
	audienceForDirection,
	isAudience,
	sampleValuesForAudience,
	tierProposal,
	AUDIENCE_VALUES,
	AGGRESSIVENESS_VALUES,
	AGGRESSIVENESS_REDUCTION_FRACTION,
	VARIABLE_CATALOG,
	sampleValues
} from '../../src/lib/shared/email-template';
import { emailTemplateAudience } from '../../src/lib/server/db/schema';

describe('renderTemplate', () => {
	test('substitutes known placeholders', () => {
		expect(renderTemplate('Rent is {{current_rent}}.', { current_rent: '$2,500' })).toBe(
			'Rent is $2,500.'
		);
	});

	test('substitutes the same placeholder repeatedly', () => {
		expect(renderTemplate('{{zip}} / {{zip}}', { zip: '11201' })).toBe('11201 / 11201');
	});

	test('tolerates inner whitespace and is case-insensitive on the key', () => {
		expect(renderTemplate('{{ current_rent }}', { current_rent: '$1' })).toBe('$1');
		expect(renderTemplate('{{CURRENT_RENT}}', { current_rent: '$1' })).toBe('$1');
	});

	test('leaves unknown placeholders intact', () => {
		expect(renderTemplate('Hello {{nope}}', { current_rent: '$1' })).toBe('Hello {{nope}}');
	});

	test('does not touch single-bracket literals', () => {
		expect(renderTemplate('Hi [Landlord name],', {})).toBe('Hi [Landlord name],');
	});
});

describe('findUnknownPlaceholders', () => {
	test('returns placeholders not in the catalog', () => {
		expect(findUnknownPlaceholders('{{current_rent}} and {{foo}} and {{bar}}')).toEqual([
			'foo',
			'bar'
		]);
	});

	test('returns empty when every placeholder is known', () => {
		expect(findUnknownPlaceholders('{{current_rent}} / {{median_rent}}')).toEqual([]);
	});

	test('dedupes repeated unknowns', () => {
		expect(findUnknownPlaceholders('{{foo}} {{foo}}')).toEqual(['foo']);
	});
});

describe('formatDollars', () => {
	test('rounds cents to whole dollars with grouping', () => {
		expect(formatDollars(250000)).toBe('$2,500');
		expect(formatDollars(0)).toBe('$0');
		expect(formatDollars(1234567)).toBe('$12,346');
	});
});

describe('sampleValues', () => {
	test('covers every catalog key', () => {
		const samples = sampleValues();
		for (const v of VARIABLE_CATALOG) {
			expect(samples[v.key]).toBe(v.sample);
		}
	});
});

describe('compareToMedian', () => {
	test('rent above the median reads "above" with a positive percentage', () => {
		expect(compareToMedian(250000, 200000)).toEqual({ pct: 25, direction: 'above' });
	});

	test('rent below the median reads "below" with a non-negative percentage', () => {
		// $1,800 current vs $3,501 median — the bug case.
		expect(compareToMedian(180000, 350100)).toEqual({ pct: 49, direction: 'below' });
	});

	test('rent equal to the median reads "0% above"', () => {
		expect(compareToMedian(200000, 200000)).toEqual({ pct: 0, direction: 'above' });
	});

	test('a sub-1% gap rounds to "0% above" rather than "0% below"', () => {
		expect(compareToMedian(199400, 200000)).toEqual({ pct: 0, direction: 'above' });
	});

	test('an unknown median reports a 0% gap instead of dividing by zero', () => {
		expect(compareToMedian(250000, 0)).toEqual({ pct: 0, direction: 'above' });
	});

	test('renders sign-correct copy for a below-median tenant', () => {
		const { pct, direction } = compareToMedian(180000, 350100);
		const sentence = renderTemplate(
			'about {{pct_above_median}}% {{median_direction}} the median',
			{ pct_above_median: String(pct), median_direction: direction }
		);
		expect(sentence).toBe('about 49% below the median');
	});
});

describe('median_direction placeholder', () => {
	test('is a recognized catalog key', () => {
		expect(findUnknownPlaceholders('{{pct_above_median}}% {{median_direction}}')).toEqual([]);
	});
});

describe('audienceForDirection', () => {
	test('a below-median tenant maps to the below-market audience', () => {
		expect(audienceForDirection('below')).toBe('below_median');
	});

	test('an above-median tenant maps to the above-market audience', () => {
		expect(audienceForDirection('above')).toBe('above_median');
	});
});

describe('isAudience', () => {
	test('accepts every valid audience value', () => {
		for (const v of AUDIENCE_VALUES) {
			expect(isAudience(v)).toBe(true);
		}
	});

	test('rejects invalid or non-string values', () => {
		expect(isAudience('')).toBe(false);
		expect(isAudience('foo')).toBe(false);
		expect(isAudience('Any')).toBe(false);
		expect(isAudience(null)).toBe(false);
		expect(isAudience(undefined)).toBe(false);
		expect(isAudience(0)).toBe(false);
	});

	test('matches the pgEnum values in the DB schema', () => {
		expect([...AUDIENCE_VALUES]).toEqual([...emailTemplateAudience.enumValues]);
	});
});

describe('tierProposal', () => {
	test('scales the reduction by the fraction', () => {
		// $2,500 current, $2,100 full target → $400 full reduction.
		const v = tierProposal(250000, 210000, 230000, 0.5);
		expect(v.reductionCents).toBe(20000); // half of $400
		expect(v.proposedCents).toBe(230000); // $2,500 − $200
	});

	test('the headline reduction always equals current − proposed', () => {
		const v = tierProposal(250000, 210000, 230000, 0.75);
		expect(v.reductionCents).toBe(250000 - v.proposedCents);
	});

	test('rounds the reduction to the nearest $50', () => {
		// $2,500 current, $2,175 target → $325 full reduction; 0.5× = $162.50.
		const v = tierProposal(250000, 217500, 240000, 0.5);
		expect(v.reductionCents).toBe(15000); // $162.50 rounds to $150
	});

	test('the fallback rent scales off its own reduction', () => {
		// Full fallback $2,400 → $100 full fallback reduction; 0.5× = $50.
		const v = tierProposal(250000, 210000, 240000, 0.5);
		expect(v.fallbackCents).toBe(245000); // $2,500 − $50
	});

	test('the three tiers ask for ascending reductions', () => {
		const reductions = AGGRESSIVENESS_VALUES.map(
			(tier) =>
				tierProposal(250000, 210000, 230000, AGGRESSIVENESS_REDUCTION_FRACTION[tier])
					.reductionCents
		);
		expect(reductions).toEqual([20000, 30000, 40000]);
		expect(reductions[0]).toBeLessThanOrEqual(reductions[1]);
		expect(reductions[1]).toBeLessThanOrEqual(reductions[2]);
	});

	test('the very-aggressive tier asks for the full recommended reduction', () => {
		const v = tierProposal(
			250000,
			210000,
			230000,
			AGGRESSIVENESS_REDUCTION_FRACTION.very_aggressive
		);
		expect(v.reductionCents).toBe(40000); // current − full target
		expect(v.proposedCents).toBe(210000);
	});
});

describe('sampleValuesForAudience', () => {
	test('below-market preview reads "below" with a below-market percentage', () => {
		const s = sampleValuesForAudience('below_median');
		expect(s.median_direction).toBe('below');
		expect(s.pct_above_median).toBe('12');
	});

	test('above-market and any keep the catalog defaults', () => {
		const base = sampleValues();
		expect(sampleValuesForAudience('above_median')).toEqual(base);
		expect(sampleValuesForAudience('any')).toEqual(base);
	});

	test('every audience still covers every catalog key', () => {
		for (const audience of AUDIENCE_VALUES) {
			const s = sampleValuesForAudience(audience);
			for (const v of VARIABLE_CATALOG) {
				expect(typeof s[v.key]).toBe('string');
			}
		}
	});
});
