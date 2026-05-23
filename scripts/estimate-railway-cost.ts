import {
	estimateRailwayCost,
	formatCostEstimateMarkdown,
	formatTimingSummaryMarkdown,
	parseVerifyCheckTimingLogs,
	type RailwayCostEstimatorInput
} from '../src/lib/shared/railway-cost-estimator';

function usage(): string {
	return `Usage: bun run scripts/estimate-railway-cost.ts <measurement.json> [verify-check.log]

Reads manually collected Railway/vendor measurement deltas and prints a
10,000-completed-flow monthly cost estimate. See
docs/railway-cost-estimation.md for collection instructions.`;
}

async function main() {
	const [, , inputPath, logPath] = Bun.argv;
	if (!inputPath || inputPath === '--help' || inputPath === '-h') {
		console.log(usage());
		return;
	}

	const input = (await Bun.file(inputPath).json()) as RailwayCostEstimatorInput;
	const estimate = estimateRailwayCost(input);
	console.log(formatCostEstimateMarkdown(estimate));

	if (logPath) {
		const logs = await Bun.file(logPath).text();
		console.log('');
		console.log(formatTimingSummaryMarkdown(parseVerifyCheckTimingLogs(logs)));
	}
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
