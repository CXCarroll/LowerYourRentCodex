<script lang="ts">
	// Annual CBSA population. Same visual grammar as PermitsHistoryChart but
	// with Y axis labeled in M / k for large integers.

	interface Point {
		year: number;
		population: number;
	}

	interface Props {
		series: Point[];
		height?: number;
	}

	const { series, height = 300 }: Props = $props();

	const COLOR = '#7c3aed'; // violet-600 — distinct from permits (blue) and vacancy (blue)

	const points = $derived(
		series
			.slice()
			.sort((a, b) => a.year - b.year)
			.filter((p) => Number.isFinite(p.population))
	);
	const hasData = $derived(points.length > 0);

	const minYear = $derived(points[0]?.year ?? 0);
	const maxYear = $derived(points[points.length - 1]?.year ?? 0);

	// Tight Y window so small % changes are readable — don't start at 0 for big
	// populations, but pad 5% above/below the actual range.
	const popMin = $derived(points.length > 0 ? Math.min(...points.map((p) => p.population)) : 0);
	const popMax = $derived(points.length > 0 ? Math.max(...points.map((p) => p.population)) : 1);
	const yLo = $derived(Math.max(0, popMin - (popMax - popMin) * 0.2));
	const yHi = $derived(popMax + (popMax - popMin) * 0.1);
	const ySpan = $derived(Math.max(1, yHi - yLo));

	const WIDTH = 560;
	const PAD_L = 56;
	const PAD_R = 8;
	const PAD_T = 8;
	const PAD_B = 22;
	const chartW = $derived(WIDTH - PAD_L - PAD_R);
	const chartH = $derived(height - PAD_T - PAD_B);

	function xFor(year: number): number {
		if (maxYear === minYear) return PAD_L + chartW / 2;
		return PAD_L + ((year - minYear) / (maxYear - minYear)) * chartW;
	}
	function yFor(pop: number): number {
		return PAD_T + chartH - ((pop - yLo) / ySpan) * chartH;
	}

	const coords = $derived(
		points.map((p) => ({ x: xFor(p.year), y: yFor(p.population), year: p.year, pop: p.population }))
	);
	const linePath = $derived(
		coords.length > 0
			? 'M ' + coords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' L ')
			: ''
	);

	function fmtPop(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
		return `${n}`;
	}

	const gridLines = $derived(
		[0, 0.25, 0.5, 0.75, 1].map((frac) => {
			const v = yLo + ySpan * frac;
			return { y: yFor(v), label: fmtPop(Math.round(v)) };
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
		<div class="text-sm text-slate-400 py-6 text-center">No population history for this CBSA</div>
	{:else}
		<svg
			viewBox="0 0 {WIDTH} {height}"
			preserveAspectRatio="none"
			style="height: {height}px; width: 100%;"
			aria-label="CBSA population history"
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
				<circle cx={c.x} cy={c.y} r={2.25} fill={COLOR}>
					<title>{c.year}: {c.pop.toLocaleString()} residents</title>
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
