import { describe, expect, test } from 'bun:test';
import {
	estimateRailwayCost,
	parseVerifyCheckTimingLogs
} from '../../src/lib/shared/railway-cost-estimator';

describe('railway cost estimator', () => {
	test('scales calibration usage to 10,000 completed flows and applies Hobby minimum', () => {
		const estimate = estimateRailwayCost({
			railwayPlan: 'hobby',
			calibration: {
				completedFlows: 100,
				app: { cpuVcpuMinutes: 1, memoryGbMinutes: 1, egressGb: 0.01 },
				postgres: { cpuVcpuMinutes: 1, memoryGbMinutes: 1 },
				mapboxTemporaryGeocodingRequests: 100,
				resendTransactionalEmails: 100,
				turnstileVerifications: 100
			}
		});

		const expected = estimate.scenarios.find((scenario) => scenario.name === 'expected');
		expect(expected).toBeDefined();
		expect(expected?.mapbox.usage).toBe(10_000);
		expect(expected?.resend.usage).toBe(10_000);
		expect(expected?.turnstile.usage).toBe(10_000);
		expect(expected?.railway.billableCostUsd).toBe(5);
		expect(expected?.resend.costUsd).toBe(20);
	});

	test('uses scenario overrides for high autocomplete and resend assumptions', () => {
		const estimate = estimateRailwayCost({
			calibration: {
				completedFlows: 100,
				mapboxTemporaryGeocodingRequests: 300,
				resendTransactionalEmails: 100,
				turnstileVerifications: 100
			},
			scenarios: {
				high: {
					mapboxRequestsPerFlow: 8,
					resendEmailsPerFlow: 2
				}
			}
		});

		const high = estimate.scenarios.find((scenario) => scenario.name === 'high');
		expect(high?.mapbox.usage).toBe(80_000);
		expect(high?.resend.usage).toBe(20_000);
		expect(high?.mapbox.costUsd).toBe(0);
		expect(high?.resend.costUsd).toBe(20);
	});

	test('scales idle baseline separately from traffic', () => {
		const estimate = estimateRailwayCost({
			railwayPlan: 'free',
			idleBaseline: {
				measuredMinutes: 1440,
				app: { memoryGbMinutes: 1440 }
			},
			calibration: {
				completedFlows: 100,
				app: { memoryGbMinutes: 100 }
			}
		});

		const expected = estimate.scenarios.find((scenario) => scenario.name === 'expected');
		expect(expected?.railway.appCostUsd).toBeCloseTo((43_200 + 10_000) * 0.000231, 5);
	});

	test('parses verify_check_timing logs with prefixes', () => {
		const summary = parseVerifyCheckTimingLogs(`
info {"event":"verify_check_timing","status":200,"timings_ms":{"geocode":10,"zip_lookup":2},"total_ms":20}
{"event":"other","total_ms":1}
railway {"event":"verify_check_timing","status":422,"timings_ms":{"geocode":30,"zip_lookup":4},"total_ms":40}
`);

		expect(summary.count).toBe(2);
		expect(summary.statuses).toEqual({ '200': 1, '422': 1 });
		expect(summary.totalMs?.avg).toBe(30);
		expect(summary.totalMs?.p95).toBe(40);
		expect(summary.spans.geocode.avg).toBe(20);
		expect(summary.spans.zip_lookup.max).toBe(4);
	});
});
