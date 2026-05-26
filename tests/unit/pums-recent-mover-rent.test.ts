import { describe, expect, test } from 'bun:test';
import {
	transformPumsRecentMoverRent,
	weightedMedianCents
} from '../../scripts/pums-recent-mover-rent-lib';

describe('PUMS recent-mover rent transform', () => {
	test('computes weighted medians after filtering to recent renter movers', () => {
		const records = [
			{ ST: '12', PUMA: '00500', TEN: '3', MV: '1', GRNTP: '1000', WGTP: '1', ADJHSG: '1000000' },
			{ ST: '12', PUMA: '00500', TEN: '3', MV: '1', GRNTP: '2000', WGTP: '3', ADJHSG: '1000000' },
			{ ST: '12', PUMA: '00500', TEN: '3', MV: '2', GRNTP: '9000', WGTP: '99', ADJHSG: '1000000' },
			{ ST: '12', PUMA: '00500', TEN: '1', MV: '1', GRNTP: '9000', WGTP: '99', ADJHSG: '1000000' },
			{ ST: '12', PUMA: '00500', TEN: '3', MV: '1', GRNTP: '-1', WGTP: '1', ADJHSG: '1000000' },
			{ ST: '12', PUMA: '00500', TEN: '3', MV: '1', GRNTP: '3000', WGTP: '0', ADJHSG: '1000000' }
		];

		const result = transformPumsRecentMoverRent(records, { year: 2024, minSampleSize: 2 });

		expect(result.rows).toEqual([
			{
				year: 2024,
				geoLevel: 'puma',
				geoId: '1200500',
				medianGrossRentCents: 200000,
				sampleSize: 2
			}
		]);
		expect(result.qualifiedRows).toBe(2);
		expect(result.skippedNotRecentRenterRows).toBe(2);
		expect(result.skippedInvalidRentRows).toBe(1);
		expect(result.skippedInvalidWeightRows).toBe(1);
	});

	test('applies ADJHSG before converting rent dollars to cents', () => {
		const result = transformPumsRecentMoverRent(
			[
				{
					STATE: '06',
					PUMA: '00101',
					TEN: '3',
					MV: '1',
					GRNTP: '1000',
					WGTP: '1',
					ADJHSG: '1100000'
				}
			],
			{ year: 2024, minSampleSize: 1 }
		);

		expect(result.rows[0].medianGrossRentCents).toBe(110000);
	});

	test('omits PUMAs below the unweighted sample threshold', () => {
		const result = transformPumsRecentMoverRent(
			[
				{ ST: '12', PUMA: '00500', TEN: '3', MV: '1', GRNTP: '1000', WGTP: '1', ADJHSG: '1000000' },
				{ ST: '12', PUMA: '00500', TEN: '3', MV: '1', GRNTP: '2000', WGTP: '1', ADJHSG: '1000000' }
			],
			{ year: 2024, minSampleSize: 3 }
		);

		expect(result.rows).toHaveLength(0);
		expect(result.skippedBelowSampleThresholdGroups).toBe(1);
	});

	test('weightedMedianCents returns the first rent crossing half total weight', () => {
		expect(
			weightedMedianCents([
				{ cents: 100000, weight: 1 },
				{ cents: 150000, weight: 1 },
				{ cents: 200000, weight: 5 }
			])
		).toBe(200000);
	});
});
