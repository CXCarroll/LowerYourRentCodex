import { describe, expect, mock, test } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: process.env }));
mock.module('$env/dynamic/public', () => ({ env: process.env }));
mock.module('$app/environment', () => ({ building: false }));

const { computeProposalFromMarketData } = await import('../../src/lib/server/proposal');

function market(overrides: Record<string, unknown> = {}) {
	return {
		zip: '11201',
		countyFips: '36047',
		cbsaCode: '35620',
		userComps: [],
		acsMedianCents: null,
		fmrCents: null,
		latestVacancyPct: null,
		recentPermits5Plus: null,
		recentPermitsFirstYear: null,
		recentPermitsLastYear: null,
		...overrides
	};
}

describe('computeProposalFromMarketData', () => {
	test('uses recent user comps when enough same-ZIP submissions are available', () => {
		const proposal = computeProposalFromMarketData({
			currentRentCents: 320_000,
			marketData: market({
				userComps: [240_000, 250_000, 260_000, 270_000, 280_000, 290_000, 300_000, 310_000],
				acsMedianCents: 999_999,
				fmrCents: 999_999,
				latestVacancyPct: 6
			})
		});

		expect(proposal?.source).toBe('user_data');
		expect(proposal?.sampleSize).toBe(8);
		expect(proposal?.targetCents).toBeLessThan(320_000);
	});

	test('blends sparse comps with ACS median', () => {
		const proposal = computeProposalFromMarketData({
			currentRentCents: 320_000,
			marketData: market({
				userComps: [280_000, 290_000, 300_000],
				acsMedianCents: 260_000,
				fmrCents: 250_000,
				latestVacancyPct: 8
			})
		});

		expect(proposal?.source).toBe('blended');
		expect(proposal?.confidence).toBe('low');
		expect(proposal?.nvrCounteroffer).not.toBeNull();
	});

	test('falls back to FMR when local comps and ACS are unavailable', () => {
		const proposal = computeProposalFromMarketData({
			currentRentCents: 300_000,
			marketData: market({ fmrCents: 240_000 })
		});

		expect(proposal?.source).toBe('fmr_fallback');
		expect(proposal?.fmrCents).toBe(240_000);
		expect(proposal?.acsMedianCents).toBeNull();
	});

	test('returns null when no market data can support a proposal', () => {
		const proposal = computeProposalFromMarketData({
			currentRentCents: 300_000,
			marketData: market()
		});

		expect(proposal).toBeNull();
	});
});
