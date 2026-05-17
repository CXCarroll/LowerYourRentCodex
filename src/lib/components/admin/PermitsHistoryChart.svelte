<script lang="ts">
	// Annual 5+ unit permits for a CBSA.
	// Same visual grammar as VacancyHistoryChart / FmrHistoryChart.

	interface Point {
		year: number;
		units5plus: number;
	}

	interface Props {
		series: Point[];
		height?: number;
	}

	const { series, height = 300 }: Props = $props();

	const COLOR = '#2563eb'; // blue-600

	const points = $derived(
		series
			.slice()
			.sort((a, b) => a.year - b.year)
			.filter((p) => Number.isFinite(p.units5plus))
	);
	const hasData = $derived(points.length > 0);

	const minYear = $derived(points[0]?.year ?? 0);
	const maxYear = $derived(points[points.length - 1]?.year ?? 0);

	// Y-axis max: round up to tidy thousands.
	const rawMax = $derived(Math.max(100, ...points.map((p) => p.units5plus)));
	const yMax = $derived.by(() => {
		// Round up to 1, 2, or 5 × 10^k.
		const k = Math.pow(10, Math.floor(Math.log10(rawMax)));
		const m = rawMax / k;
		const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
		return step * k;
	});

	const WIDTH = 560;
	const PAD_L = 48;
	const PAD_R = 8;
	const PAD_T = 8;
	const PAD_B = 22;
	const chartW = $derived(WIDTH - PAD_L - PAD_R);
	const chartH = $derived(height - PAD_T - PAD_B);

	function xFor(year: number): number {
		if (maxYear === minYear) return PAD_L + chartW / 2;
		return PAD_L + ((year - minYear) / (maxYear - minYear)) * chartW;
	}
	function yFor(units: number): number {
		return PAD_T + chartH - (units / yMax) * chartH;
	}

	const coords = $derived(
		points.map((p) => ({ x: xFor(p.year), y: yFor(p.units5plus), year: p.year, units: p.units5plus }))
	);
	const linePath = $derived(
		coords.length > 0
			? 'M ' + coords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' L ')
			: ''
	);
	const areaPath = $derived(
		coords.length > 0
			? `M ${coords[0].x.toFixed(2)},${PAD_T + chartH} L ` +
					coords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' L ') +
					` L ${coords[coords.length - 1].x.toFixed(2)},${PAD_T + chartH} Z`
			: ''
	);

	function fmtUnits(n: number): string {
		if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
		return `${n}`;
	}

	const gridLines = $derived(
		[0, 0.25, 0.5, 0.75, 1].map((frac) => {
			const units = yMax * frac;
			return { y: yFor(units), label: fmtUnits(Math.round(units)) };
		})
	);

	const yearTicks = $derived.by(() => {
		if (points.length === 0) return [] as number[];
		const years = points.map((p) => p.year);
		if (years.length <= 6) return years;
		const step = Math.ceil(years.length / 6);
		return years.filter((_, i) => i % step === 0 || i === years.length - 1);
	});
</script>

<div class="card flex flex-col gap-2" style="padding: 16px;">
	{#if !hasData}
		<div class="text-sm text-slate-400 py-6 text-center">No permit history for this CBSA</div>
	{:else}
		<svg
			viewBox="0 0 {WIDTH} {height}"
			preserveAspectRatio="none"
			style="height: {height}px; width: 100%;"
			aria-label="5+ unit building permits history"
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

			<path d={areaPath} fill="#dbeafe" opacity="0.55" />
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
				<circle cx={c.x} cy={c.y} r={2.25} fill={COLOR}>
					<title>{c.year}: {c.units.toLocaleString()} units permitted (5+ unit buildings)</title>
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
