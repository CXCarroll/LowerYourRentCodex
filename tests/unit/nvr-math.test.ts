import { describe, expect, test } from 'bun:test';
import {
	DEFAULTS,
	recommendCounteroffer,
	selectRegime
} from '../../src/lib/server/nvr-math';

describe('selectRegime', () => {
	test('linear below V* + 2pp', () => {
		expect(selectRegime(0)).toBe('linear');
		expect(selectRegime(0.019)).toBe('linear');
	});
	test('asymmetric at V* + 2pp up to (not including) +4pp', () => {
		expect(selectRegime(0.02)).toBe('asymmetric');
		expect(selectRegime(0.035)).toBe('asymmetric');
	});
	test('quadratic at V* + 4pp and above', () => {
		expect(selectRegime(0.04)).toBe('quadratic');
		expect(selectRegime(0.12)).toBe('quadratic');
	});
});

describe('recommendCounteroffer', () => {
	test('Chicago-ish (V=8%, asymmetric) drops ~2%', () => {
		const r = recommendCounteroffer({ currentRentCents: 2000_00, vacancyPct: 8.0 });
		expect(r).not.toBeNull();
		expect(r!.regime).toBe('asymmetric');
		// 0.60 * (0.06 - 0.08) = -0.012; /0.50 = -0.024; *0.80 = 0.0192
		// 2000 * (1 - 0.0192) = 1961.60
		expect(r!.counterofferRentCents).toBe(196160);
	});

	test('Austin-ish (V=14%, quadratic) drops ~14%', () => {
		const r = recommendCounteroffer({ currentRentCents: 2000_00, vacancyPct: 14.0 });
		expect(r).not.toBeNull();
		expect(r!.regime).toBe('quadratic');
		// Expected around $1718.40
		expect(r!.counterofferRentCents).toBeGreaterThan(170000);
		expect(r!.counterofferRentCents).toBeLessThan(173000);
	});

	test('tight market (V=4%, linear) yields no discount', () => {
		const r = recommendCounteroffer({ currentRentCents: 2000_00, vacancyPct: 4.0 });
		expect(r).not.toBeNull();
		expect(r!.regime).toBe('linear');
		expect(r!.spotDiscount).toBe(0);
		expect(r!.counterofferRentCents).toBe(2000_00);
	});

	test('at equilibrium (V=V*) yields no discount', () => {
		const r = recommendCounteroffer({ currentRentCents: 2500_00, vacancyPct: 6.0 });
		expect(r).not.toBeNull();
		expect(r!.spotDiscount).toBe(0);
		expect(r!.counterofferRentCents).toBe(2500_00);
	});

	test('null vacancy returns null', () => {
		expect(recommendCounteroffer({ currentRentCents: 2000_00, vacancyPct: null })).toBeNull();
	});

	test('spot discount clamped at maxDiscount', () => {
		// V=50% is absurdly high; the clamp must bite.
		const r = recommendCounteroffer({ currentRentCents: 2000_00, vacancyPct: 50.0 });
		expect(r).not.toBeNull();
		expect(r!.spotDiscount).toBe(DEFAULTS.maxDiscount);
	});

	test('custom turnoverRate changes the result', () => {
		const base = recommendCounteroffer({ currentRentCents: 2000_00, vacancyPct: 10.0 });
		const lowTurnover = recommendCounteroffer({
			currentRentCents: 2000_00,
			vacancyPct: 10.0,
			turnoverRate: 0.25
		});
		// Lower turnover ⇒ larger spot swing ⇒ bigger discount.
		expect(lowTurnover!.spotDiscount).toBeGreaterThan(base!.spotDiscount);
		expect(lowTurnover!.counterofferRentCents).toBeLessThan(base!.counterofferRentCents);
	});

	test('counteroffer is an integer number of cents', () => {
		const r = recommendCounteroffer({ currentRentCents: 1_543_21, vacancyPct: 9.3 });
		expect(r).not.toBeNull();
		expect(Number.isInteger(r!.counterofferRentCents)).toBe(true);
	});
});
