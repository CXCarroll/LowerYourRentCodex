<script lang="ts">
	// Quarterly rental vacancy rate for a CBSA, as a single line.
	// Matches FmrHistoryChart.svelte geometry so the two read as a pair.

	interface Point {
		year: number;
		quarter: number;
		pct: number;
	}

	interface Props {
		series: Point[];
		height?: number;
	}

	const { series, height = 300 }: Props = $props();

	const COLOR = '#2563eb'; // blue-600 — same headline hue as 2BR in the FMR chart

	const points = $derived(
		series
			.slice()
			.sort((a, b) => a.year - b.year || a.quarter - b.quarter)
			.filter((p) => Number.isFinite(p.pct))
	);
	const hasData = $derived(points.length > 0);

	// Convert (year, quarter) -> a fractional year so spacing reflects real time.
	function periodValue(p: { year: number; quarter: number }): number {
		return p.year + (p.quarter - 1) / 4;
	}

	const minPeriod = $derived(points.length > 0 ? periodValue(points[0]) : 0);
	const maxPeriod = $derived(
		points.length > 0 ? periodValue(points[points.length - 1]) : 0
	);

	// Y-axis: round up to next whole percent, clamp to a sensible minimum.
	const maxPct = $derived(Math.max(5, ...points.map((p) => p.pct)));
	const yMax = $derived(Math.ceil(maxPct));

	const WIDTH = 560;
	const PAD_L = 40;
	const PAD_R = 8;
	const PAD_T = 8;
	const PAD_B = 22;
	const chartW = $derived(WIDTH - PAD_L - PAD_R);
	const chartH = $derived(height - PAD_T - PAD_B);

	function xFor(period: number): number {
		if (maxPeriod === minPeriod) return PAD_L + chartW / 2;
		return PAD_L + ((period - minPeriod) / (maxPeriod - minPeriod)) * chartW;
	}
	function yFor(pct: number): number {
		return PAD_T + chartH - (pct / yMax) * chartH;
	}

	const coords = $derived(
		points.map((p) => ({
			x: xFor(periodValue(p)),
			y: yFor(p.pct),
			year: p.year,
			quarter: p.quarter,
			pct: p.pct
		}))
	);

	const linePath = $derived(
		coords.length > 0
			? 'M ' + coords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' L ')
			: ''
	);

	const gridLines = $derived(
		[0, 0.25, 0.5, 0.75, 1].map((frac) => {
			const pct = yMax * frac;
			return { y: yFor(pct), label: `${pct.toFixed(1)}%` };
		})
	);

	// Year-level tick labels (one per calendar year that appears in the data).
	const yearTicks = $derived.by(() => {
		if (points.length === 0) return [] as number[];
		const years = Array.from(new Set(points.map((p) => p.year))).sort((a, b) => a - b);
		if (years.length <= 6) return years;
		// Thin to ~6 evenly spaced labels.
		const step = Math.ceil(years.length / 6);
		return years.filter((_, i) => i % step === 0 || i === years.length - 1);
	});
</script>

<div class="card flex flex-col gap-2" style="padding: 16px;">
	{#if !hasData}
		<div class="text-sm text-slate-400 py-6 text-center">No vacancy history for this CBSA</div>
	{:else}
		<svg
			viewBox="0 0 {WIDTH} {height}"
			preserveAspectRatio="none"
			style="height: {height}px; width: 100%;"
			aria-label="Rental vacancy rate history"
		>
			{#each gridLines as g, i (i)}
				<line
					x1={PAD_L}
					x2={WIDTH - PAD_R}
					y1={g.y}
					y2={g.y}
					stroke="var(--color-brand-100, #e2e8f0)"
					stroke-width={1}
					vector-effect="non-scaling-stroke"
				/>
				<text
					x={PAD_L - 6}
					y={g.y}
					text-anchor="end"
					dominant-baseline="middle"
					font-size="9"
					fill="#94a3b8"
					font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
				>
					{g.label}
				</text>
			{/each}

			<path
				d={linePath}
				fill="none"
				stroke={COLOR}
				stroke-width={1.75}
				stroke-linejoin="round"
				stroke-linecap="round"
				vector-effect="non-scaling-stroke"
			/>
			{#each coords as c, i (i)}
				<circle cx={c.x} cy={c.y} r={2} fill={COLOR}>
					<title>Q{c.quarter} {c.year}: {c.pct.toFixed(1)}%</title>
				</circle>
			{/each}

			{#each yearTicks as y (y)}
				<text
					x={xFor(y)}
					y={height - 6}
					text-anchor="middle"
					font-size="10"
					fill="#94a3b8"
					font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
				>
					{y}
				</text>
			{/each}
		</svg>
	{/if}
</div>
