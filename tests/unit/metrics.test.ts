import { describe, expect, test } from 'bun:test';
import { fillDailyBuckets, fillHourlyBuckets } from '../../src/lib/server/admin/metrics-buckets';

describe('fillDailyBuckets', () => {
	test('zero-fills a 7-day window with no data', () => {
		const start = new Date('2026-04-10T00:00:00Z');
		const end = new Date('2026-04-16T00:00:00Z');
		const out = fillDailyBuckets(start, end, new Map());
		expect(out.length).toBe(7);
		expect(out[0]).toEqual({ date: '2026-04-10', count: 0 });
		expect(out[6]).toEqual({ date: '2026-04-16', count: 0 });
	});

	test('merges sparse data correctly', () => {
		const start = new Date('2026-04-10T00:00:00Z');
		const end = new Date('2026-04-13T00:00:00Z');
		const map = new Map([
			['2026-04-10', 3],
			['2026-04-13', 7]
		]);
		const out = fillDailyBuckets(start, end, map);
		expect(out).toEqual([
			{ date: '2026-04-10', count: 3 },
			{ date: '2026-04-11', count: 0 },
			{ date: '2026-04-12', count: 0 },
			{ date: '2026-04-13', count: 7 }
		]);
	});

	test('normalizes to UTC midnight even if start is mid-day', () => {
		const start = new Date('2026-04-10T18:30:00Z');
		const end = new Date('2026-04-11T05:00:00Z');
		const out = fillDailyBuckets(start, end, new Map());
		expect(out.map((b) => b.date)).toEqual(['2026-04-10', '2026-04-11']);
	});
});

describe('fillHourlyBuckets', () => {
	test('zero-fills a 24-hour window', () => {
		const start = new Date('2026-04-18T00:00:00Z');
		const end = new Date('2026-04-18T23:00:00Z');
		const out = fillHourlyBuckets(start, end, new Map());
		expect(out.length).toBe(24);
		expect(out[0].hour).toBe('2026-04-18T00:00:00Z');
		expect(out[23].hour).toBe('2026-04-18T23:00:00Z');
		expect(out.every((b) => b.count === 0)).toBe(true);
	});

	test('merges provided counts', () => {
		const start = new Date('2026-04-18T10:00:00Z');
		const end = new Date('2026-04-18T12:00:00Z');
		const map = new Map([['2026-04-18T11:00:00Z', 5]]);
		const out = fillHourlyBuckets(start, end, map);
		expect(out).toEqual([
			{ hour: '2026-04-18T10:00:00Z', count: 0 },
			{ hour: '2026-04-18T11:00:00Z', count: 5 },
			{ hour: '2026-04-18T12:00:00Z', count: 0 }
		]);
	});

	test('drops sub-hour precision on start/end', () => {
		const start = new Date('2026-04-18T10:37:22Z');
		const end = new Date('2026-04-18T11:12:00Z');
		const out = fillHourlyBuckets(start, end, new Map());
		expect(out.map((b) => b.hour)).toEqual([
			'2026-04-18T10:00:00Z',
			'2026-04-18T11:00:00Z'
		]);
	});
});
