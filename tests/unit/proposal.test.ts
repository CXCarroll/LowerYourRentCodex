import { describe, expect, test } from 'bun:test';
import {
	buildDistribution,
	computeTiers,
	labelConfidence,
	percentile,
	vacancyAdjustment
} from '../../src/lib/server/proposal-math';

describe('percentile', () => {
	test('single element returns itself', () => {
		expect(percentile([500], 50)).toBe(500);
		expect(percentile([500], 25)).toBe(500);
	});
	test('median of 5 values', () => {
		expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
	});
	test('p25 + p75 interpolate linearly', () => {
		const s = [100, 200, 300, 400, 500];
		expect(percentile(s, 25)).toBe(200);
		expect(percentile(s, 75)).toBe(400);
	});
	test('throws on empty', () => {
		expect(() => percentile([], 50)).toThrow();
	});
});

describe('buildDistribution', () => {
	test('N>=8 uses user data only', () => {
		const comps = [2000, 2100, 2200, 2300, 2400, 2500, 2600, 2700];
		const d = buildDistribution({ userComps: comps, acsMedianCents: 9999999, fmrCents: 9999999 });
		expect(d?.source).toBe('user_data');
		expect(d?.median).toBeCloseTo(2350, 0);
	});
	test('3<=N<8 blends with ACS', () => {
		const d = buildDistribution({ userComps: [2500, 2600, 2700], acsMedianCents: 2000, fmrCents: 1000 });
		expect(d?.source).toBe('blended');
		// Weighted toward ACS since n=3 -> wUser = 3/11 ≈ 0.273
		expect(d!.median).toBeGreaterThan(2000);
		expect(d!.median).toBeLessThan(2600);
	});
	test('N<3 and FMR present -> fmr_fallback', () => {
		const d = buildDistribution({ userComps: [2500], acsMedianCents: null, fmrCents: 2000 });
		expect(d?.source).toBe('fmr_fallback');
		expect(d?.median).toBe(2000);
		expect(d?.p25).toBeCloseTo(1700, 0);
		expect(d?.p75).toBeCloseTo(2300, 0);
	});
	test('no FMR, only ACS -> falls back to ACS', () => {
		const d = buildDistribution({ userComps: [], acsMedianCents: 2000, fmrCents: null });
		expect(d?.source).toBe('fmr_fallback');
		expect(d?.median).toBe(2000);
	});
	test('no data at all -> null', () => {
		const d = buildDistribution({ userComps: [], acsMedianCents: null, fmrCents: null });
		expect(d).toBeNull();
	});
});

describe('vacancyAdjustment', () => {
	test('at baseline 6% vacancy returns 1.0', () => {
		expect(vacancyAdjustment(6.0)).toBe(1.0);
	});
	test('below baseline (tight market) stays at 1.0 (no penalty for tenant)', () => {
		expect(vacancyAdjustment(3.0)).toBe(1.0);
	});
	test('high vacancy (loose market) pulls adjustment down', () => {
		expect(vacancyAdjustment(10.0)).toBeCloseTo(1 - 4 * 0.005, 5); // 0.98
	});
	test('clamped to 0.92 floor', () => {
		expect(vacancyAdjustment(50.0)).toBe(0.92);
	});
	test('null defaults to 6% -> 1.0', () => {
		expect(vacancyAdjustment(null)).toBe(1.0);
	});
});

describe('computeTiers', () => {
	const mkDist = (median: number) => ({
		median,
		p25: median * 0.85,
		p75: median * 1.15,
		source: 'fmr_fallback' as const
	});

	test('never proposes above current rent', () => {
		const dist = mkDist(3500_00); // market median > current rent
		const tiers = computeTiers(dist, 1.0, 3000_00);
		expect(tiers.targetCents).toBeLessThanOrEqual(3000_00);
		expect(tiers.lowCents).toBeLessThanOrEqual(3000_00);
		expect(tiers.walkAwayCents).toBeLessThanOrEqual(3000_00);
	});
	test('low <= target <= walkAway invariant', () => {
		const dist = mkDist(2500_00);
		const tiers = computeTiers(dist, 1.0, 3000_00);
		expect(tiers.lowCents).toBeLessThanOrEqual(tiers.targetCents);
		expect(tiers.targetCents).toBeLessThanOrEqual(tiers.walkAwayCents);
	});
	test('low <= current * 0.97 (always some reduction)', () => {
		const dist = mkDist(3500_00);
		const tiers = computeTiers(dist, 1.0, 3000_00);
		expect(tiers.lowCents).toBeLessThanOrEqual(Math.round(3000_00 * 0.97));
	});
	test('vacancy adjustment flows through to target', () => {
		const dist = mkDist(3000_00);
		const hi = computeTiers(dist, 1.0, 4000_00);
		const lo = computeTiers(dist, 0.95, 4000_00);
		expect(lo.targetCents).toBeLessThan(hi.targetCents);
	});
});

describe('labelConfidence', () => {
	test('user_data high when N >= 20', () => {
		expect(labelConfidence('user_data', 20)).toBe('high');
		expect(labelConfidence('user_data', 100)).toBe('high');
	});
	test('user_data medium when 8 <= N < 20', () => {
		expect(labelConfidence('user_data', 8)).toBe('medium');
		expect(labelConfidence('user_data', 19)).toBe('medium');
	});
	test('blended -> low', () => {
		expect(labelConfidence('blended', 5)).toBe('low');
	});
	test('fmr_fallback -> very_low', () => {
		expect(labelConfidence('fmr_fallback', 0)).toBe('very_low');
	});
});
