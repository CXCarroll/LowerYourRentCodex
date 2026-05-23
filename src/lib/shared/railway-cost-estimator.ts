export type RailwayPlan = 'free' | 'hobby' | 'pro';
export type ScenarioName = 'low' | 'expected' | 'high';

export interface RailwayResourceUsage {
	cpuVcpuMinutes?: number;
	memoryGbMinutes?: number;
	egressGb?: number;
	volumeStorageGbMinutes?: number;
}

export interface RailwayComponentUsage {
	app?: RailwayResourceUsage;
	postgres?: RailwayResourceUsage;
}

export interface CalibrationMeasurement extends RailwayComponentUsage {
	completedFlows: number;
	mapboxTemporaryGeocodingRequests?: number;
	resendTransactionalEmails?: number;
	turnstileVerifications?: number;
}

export interface IdleBaselineMeasurement extends RailwayComponentUsage {
	measuredMinutes: number;
}

export interface ScenarioOverride {
	mapboxRequestsPerFlow?: number;
	resendEmailsPerFlow?: number;
	turnstileVerificationsPerFlow?: number;
	railwayTrafficMultiplier?: number;
	note?: string;
}

export interface RailwayCostEstimatorInput {
	targetCompletedFlows?: number;
	monthMinutes?: number;
	railwayPlan?: RailwayPlan;
	idleBaseline?: IdleBaselineMeasurement;
	calibration: CalibrationMeasurement;
	scenarios?: Partial<Record<ScenarioName, ScenarioOverride>>;
}

export interface VendorEstimate {
	usage: number;
	costUsd: number;
}

export interface RailwayEstimate {
	appCostUsd: number;
	postgresCostUsd: number;
	resourceCostUsd: number;
	planMinimumUsd: number;
	billableCostUsd: number;
}

export interface ScenarioEstimate {
	name: ScenarioName;
	railway: RailwayEstimate;
	mapbox: VendorEstimate;
	resend: VendorEstimate;
	turnstile: VendorEstimate;
	totalCostUsd: number;
	notes: string[];
}

export interface CostEstimate {
	targetCompletedFlows: number;
	monthMinutes: number;
	railwayPlan: RailwayPlan;
	scenarios: ScenarioEstimate[];
}

export interface VerifyTimingSummary {
	count: number;
	totalMs: TimingStats | null;
	spans: Record<string, TimingStats>;
	statuses: Record<string, number>;
}

export interface TimingStats {
	avg: number;
	p95: number;
	max: number;
}

const DEFAULT_TARGET_COMPLETED_FLOWS = 10_000;
const DEFAULT_MONTH_MINUTES = 30 * 24 * 60;

const RAILWAY_PLAN_MINIMUM_USD: Record<RailwayPlan, number> = {
	free: 0,
	hobby: 5,
	pro: 20
};

const RAILWAY_RATES = {
	cpuPerVcpuMinute: 0.000463,
	memoryPerGbMinute: 0.000231,
	egressPerGb: 0.05,
	volumeStoragePerGbMinute: 0.000003472222222
};

const SCENARIO_NAMES: ScenarioName[] = ['low', 'expected', 'high'];

function usageValue(value: number | undefined): number {
	return Number.isFinite(value) ? Number(value) : 0;
}

function addUsage(a: RailwayResourceUsage = {}, b: RailwayResourceUsage = {}): RailwayResourceUsage {
	return {
		cpuVcpuMinutes: usageValue(a.cpuVcpuMinutes) + usageValue(b.cpuVcpuMinutes),
		memoryGbMinutes: usageValue(a.memoryGbMinutes) + usageValue(b.memoryGbMinutes),
		egressGb: usageValue(a.egressGb) + usageValue(b.egressGb),
		volumeStorageGbMinutes:
			usageValue(a.volumeStorageGbMinutes) + usageValue(b.volumeStorageGbMinutes)
	};
}

function scaleUsage(usage: RailwayResourceUsage = {}, scale: number): RailwayResourceUsage {
	return {
		cpuVcpuMinutes: usageValue(usage.cpuVcpuMinutes) * scale,
		memoryGbMinutes: usageValue(usage.memoryGbMinutes) * scale,
		egressGb: usageValue(usage.egressGb) * scale,
		volumeStorageGbMinutes: usageValue(usage.volumeStorageGbMinutes) * scale
	};
}

function railwayResourceCost(usage: RailwayResourceUsage): number {
	return (
		usageValue(usage.cpuVcpuMinutes) * RAILWAY_RATES.cpuPerVcpuMinute +
		usageValue(usage.memoryGbMinutes) * RAILWAY_RATES.memoryPerGbMinute +
		usageValue(usage.egressGb) * RAILWAY_RATES.egressPerGb +
		usageValue(usage.volumeStorageGbMinutes) * RAILWAY_RATES.volumeStoragePerGbMinute
	);
}

function mapboxTemporaryGeocodingCost(requests: number): number {
	const tiers = [
		{ included: 100_000, unitCost: 0 },
		{ included: 400_000, unitCost: 0.75 },
		{ included: 500_000, unitCost: 0.6 },
		{ included: Number.POSITIVE_INFINITY, unitCost: 0.45 }
	];
	let remaining = Math.max(0, requests);
	let cost = 0;
	for (const tier of tiers) {
		const used = Math.min(remaining, tier.included);
		cost += (used / 1000) * tier.unitCost;
		remaining -= used;
		if (remaining <= 0) break;
	}
	return cost;
}

function resendTransactionalEmailCost(emails: number): number {
	const plans = [
		{ price: 0, included: 3_000, overagePerThousand: null },
		{ price: 20, included: 50_000, overagePerThousand: 0.9 },
		{ price: 35, included: 100_000, overagePerThousand: 0.9 },
		{ price: 90, included: 100_000, overagePerThousand: 0.9 },
		{ price: 160, included: 200_000, overagePerThousand: 0.8 },
		{ price: 350, included: 500_000, overagePerThousand: 0.7 },
		{ price: 650, included: 1_000_000, overagePerThousand: 0.65 },
		{ price: 825, included: 1_500_000, overagePerThousand: 0.52 },
		{ price: 1150, included: 2_500_000, overagePerThousand: 0.46 }
	];

	return Math.min(
		...plans
			.filter((plan) => plan.overagePerThousand != null || emails <= plan.included)
			.map((plan) => {
				const overage = Math.max(0, emails - plan.included);
				return plan.price + (overage / 1000) * (plan.overagePerThousand ?? 0);
			})
	);
}

function assertFiniteNonNegative(name: string, value: number): void {
	if (!Number.isFinite(value) || value < 0) {
		throw new Error(`${name} must be a non-negative finite number.`);
	}
}

function validateInput(input: RailwayCostEstimatorInput): Required<
	Pick<RailwayCostEstimatorInput, 'targetCompletedFlows' | 'monthMinutes' | 'railwayPlan'>
> {
	const targetCompletedFlows = input.targetCompletedFlows ?? DEFAULT_TARGET_COMPLETED_FLOWS;
	const monthMinutes = input.monthMinutes ?? DEFAULT_MONTH_MINUTES;
	const railwayPlan = input.railwayPlan ?? 'hobby';

	assertFiniteNonNegative('targetCompletedFlows', targetCompletedFlows);
	assertFiniteNonNegative('monthMinutes', monthMinutes);
	assertFiniteNonNegative('calibration.completedFlows', input.calibration.completedFlows);
	if (targetCompletedFlows === 0) throw new Error('targetCompletedFlows must be greater than 0.');
	if (monthMinutes === 0) throw new Error('monthMinutes must be greater than 0.');
	if (input.calibration.completedFlows === 0) {
		throw new Error('calibration.completedFlows must be greater than 0.');
	}
	if (input.idleBaseline) {
		assertFiniteNonNegative('idleBaseline.measuredMinutes', input.idleBaseline.measuredMinutes);
		if (input.idleBaseline.measuredMinutes === 0) {
			throw new Error('idleBaseline.measuredMinutes must be greater than 0.');
		}
	}

	return { targetCompletedFlows, monthMinutes, railwayPlan };
}

function observedPerFlow(value: number | undefined, completedFlows: number): number {
	return usageValue(value) / completedFlows;
}

function scenarioDefaults(
	name: ScenarioName,
	input: RailwayCostEstimatorInput
): Required<Omit<ScenarioOverride, 'note'>> {
	const completedFlows = input.calibration.completedFlows;
	const observedMapbox = observedPerFlow(
		input.calibration.mapboxTemporaryGeocodingRequests,
		completedFlows
	);
	const observedResend = observedPerFlow(input.calibration.resendTransactionalEmails, completedFlows);
	const observedTurnstile = observedPerFlow(input.calibration.turnstileVerifications, completedFlows);

	if (name === 'low') {
		return {
			mapboxRequestsPerFlow: 1,
			resendEmailsPerFlow: 1,
			turnstileVerificationsPerFlow: Math.max(1, observedTurnstile),
			railwayTrafficMultiplier: 1
		};
	}
	if (name === 'high') {
		return {
			mapboxRequestsPerFlow: Math.max(1, observedMapbox),
			resendEmailsPerFlow: Math.max(2, observedResend),
			turnstileVerificationsPerFlow: Math.max(1, observedTurnstile),
			railwayTrafficMultiplier: 1
		};
	}
	return {
		mapboxRequestsPerFlow: observedMapbox,
		resendEmailsPerFlow: observedResend,
		turnstileVerificationsPerFlow: observedTurnstile,
		railwayTrafficMultiplier: 1
	};
}

function scenarioConfig(
	name: ScenarioName,
	input: RailwayCostEstimatorInput
): Required<Omit<ScenarioOverride, 'note'>> & { note?: string } {
	return {
		...scenarioDefaults(name, input),
		...(input.scenarios?.[name] ?? {})
	};
}

function estimateRailway(
	input: RailwayCostEstimatorInput,
	targetCompletedFlows: number,
	monthMinutes: number,
	railwayPlan: RailwayPlan,
	railwayTrafficMultiplier: number
): RailwayEstimate {
	const trafficScale =
		(targetCompletedFlows / input.calibration.completedFlows) * railwayTrafficMultiplier;
	const idleScale = input.idleBaseline ? monthMinutes / input.idleBaseline.measuredMinutes : 0;

	const appUsage = addUsage(
		scaleUsage(input.idleBaseline?.app, idleScale),
		scaleUsage(input.calibration.app, trafficScale)
	);
	const postgresUsage = addUsage(
		scaleUsage(input.idleBaseline?.postgres, idleScale),
		scaleUsage(input.calibration.postgres, trafficScale)
	);
	const appCostUsd = railwayResourceCost(appUsage);
	const postgresCostUsd = railwayResourceCost(postgresUsage);
	const resourceCostUsd = appCostUsd + postgresCostUsd;
	const planMinimumUsd = RAILWAY_PLAN_MINIMUM_USD[railwayPlan];

	return {
		appCostUsd,
		postgresCostUsd,
		resourceCostUsd,
		planMinimumUsd,
		billableCostUsd: Math.max(resourceCostUsd, planMinimumUsd)
	};
}

export function estimateRailwayCost(input: RailwayCostEstimatorInput): CostEstimate {
	const { targetCompletedFlows, monthMinutes, railwayPlan } = validateInput(input);

	return {
		targetCompletedFlows,
		monthMinutes,
		railwayPlan,
		scenarios: SCENARIO_NAMES.map((name) => {
			const config = scenarioConfig(name, input);
			assertFiniteNonNegative(`${name}.mapboxRequestsPerFlow`, config.mapboxRequestsPerFlow);
			assertFiniteNonNegative(`${name}.resendEmailsPerFlow`, config.resendEmailsPerFlow);
			assertFiniteNonNegative(
				`${name}.turnstileVerificationsPerFlow`,
				config.turnstileVerificationsPerFlow
			);
			assertFiniteNonNegative(`${name}.railwayTrafficMultiplier`, config.railwayTrafficMultiplier);

			const railway = estimateRailway(
				input,
				targetCompletedFlows,
				monthMinutes,
				railwayPlan,
				config.railwayTrafficMultiplier
			);
			const mapboxUsage = config.mapboxRequestsPerFlow * targetCompletedFlows;
			const resendUsage = config.resendEmailsPerFlow * targetCompletedFlows;
			const turnstileUsage = config.turnstileVerificationsPerFlow * targetCompletedFlows;
			const notes = [];
			if (config.note) notes.push(config.note);
			if (name === 'low') notes.push('No autocomplete; one submit-time geocode/check per flow.');
			if (name === 'high') notes.push('Includes one resend by default unless overridden.');

			const mapbox = {
				usage: mapboxUsage,
				costUsd: mapboxTemporaryGeocodingCost(mapboxUsage)
			};
			const resend = {
				usage: resendUsage,
				costUsd: resendTransactionalEmailCost(resendUsage)
			};
			const turnstile = {
				usage: turnstileUsage,
				costUsd: 0
			};

			return {
				name,
				railway,
				mapbox,
				resend,
				turnstile,
				totalCostUsd: railway.billableCostUsd + mapbox.costUsd + resend.costUsd + turnstile.costUsd,
				notes
			};
		})
	};
}

function usd(value: number): string {
	return `$${value.toFixed(2)}`;
}

function whole(value: number): string {
	return Math.round(value).toLocaleString('en-US');
}

export function formatCostEstimateMarkdown(estimate: CostEstimate): string {
	const rows = [
		'| Scenario | Railway app | Railway Postgres | Railway billed | Mapbox requests / cost | Resend emails / cost | Turnstile verifications / cost | Total |',
		'| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
		...estimate.scenarios.map((scenario) =>
			`| ${[
				scenario.name,
				usd(scenario.railway.appCostUsd),
				usd(scenario.railway.postgresCostUsd),
				usd(scenario.railway.billableCostUsd),
				`${whole(scenario.mapbox.usage)} / ${usd(scenario.mapbox.costUsd)}`,
				`${whole(scenario.resend.usage)} / ${usd(scenario.resend.costUsd)}`,
				`${whole(scenario.turnstile.usage)} / ${usd(scenario.turnstile.costUsd)}`,
				usd(scenario.totalCostUsd)
			].join(' | ')} |`
		)
	].join('\n');

	const notes = estimate.scenarios
		.flatMap((scenario) => scenario.notes.map((note) => `- ${scenario.name}: ${note}`))
		.join('\n');

	return [
		`# Railway Cost Estimate`,
		``,
		`Target completed flows: ${whole(estimate.targetCompletedFlows)}`,
		`Railway plan: ${estimate.railwayPlan}`,
		`Month length: ${whole(estimate.monthMinutes)} minutes`,
		``,
		rows,
		notes ? `\n## Scenario Notes\n${notes}` : ''
	]
		.filter(Boolean)
		.join('\n');
}

function percentile(values: number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
	return sorted[index];
}

function stats(values: number[]): TimingStats | null {
	if (values.length === 0) return null;
	const sum = values.reduce((acc, value) => acc + value, 0);
	return {
		avg: sum / values.length,
		p95: percentile(values, 95),
		max: Math.max(...values)
	};
}

export function parseVerifyCheckTimingLogs(text: string): VerifyTimingSummary {
	const totals: number[] = [];
	const spans = new Map<string, number[]>();
	const statuses: Record<string, number> = {};

	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed.includes('verify_check_timing')) continue;

		const jsonStart = trimmed.indexOf('{');
		if (jsonStart < 0) continue;

		let entry: unknown;
		try {
			entry = JSON.parse(trimmed.slice(jsonStart));
		} catch {
			continue;
		}

		if (!entry || typeof entry !== 'object' || (entry as { event?: unknown }).event !== 'verify_check_timing') {
			continue;
		}

		const status = (entry as { status?: unknown }).status;
		if (typeof status === 'number') statuses[String(status)] = (statuses[String(status)] ?? 0) + 1;

		const total = (entry as { total_ms?: unknown }).total_ms;
		if (typeof total === 'number' && Number.isFinite(total)) totals.push(total);

		const timings = (entry as { timings_ms?: unknown }).timings_ms;
		if (!timings || typeof timings !== 'object') continue;
		for (const [name, value] of Object.entries(timings)) {
			if (typeof value !== 'number' || !Number.isFinite(value)) continue;
			const bucket = spans.get(name) ?? [];
			bucket.push(value);
			spans.set(name, bucket);
		}
	}

	return {
		count: totals.length,
		totalMs: stats(totals),
		spans: Object.fromEntries(
			Array.from(spans.entries()).map(([name, values]) => [name, stats(values) as TimingStats])
		),
		statuses
	};
}

export function formatTimingSummaryMarkdown(summary: VerifyTimingSummary): string {
	if (summary.count === 0 || !summary.totalMs) {
		return 'No verify_check_timing log entries found.';
	}

	const rows = [
		'| Span | Avg ms | P95 ms | Max ms |',
		'| --- | ---: | ---: | ---: |',
		`| total | ${summary.totalMs.avg.toFixed(2)} | ${summary.totalMs.p95.toFixed(2)} | ${summary.totalMs.max.toFixed(2)} |`,
		...Object.entries(summary.spans)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(
				([name, value]) =>
					`| ${name} | ${value.avg.toFixed(2)} | ${value.p95.toFixed(2)} | ${value.max.toFixed(2)} |`
			)
	];

	const statuses = Object.entries(summary.statuses)
		.sort(([a], [b]) => Number(a) - Number(b))
		.map(([status, count]) => `${status}: ${count}`)
		.join(', ');

	return [`## /api/verify/check Timing Summary`, `Entries: ${summary.count}`, `Statuses: ${statuses}`, '', rows.join('\n')].join(
		'\n'
	);
}
