<script lang="ts">
	// Vertical bar chart for year-over-year % change series. Positive bars are
	// emerald, negative are rose, with a zero baseline. Shares the geometry
	// idiom of the other history charts (same viewBox width + padding).

	interface Point {
		year: number;
		pct: number;
	}

	interface Props {
		series: Point[];
		/** Label prefix for the hover tooltip, e.g. "Permits" or "Population". */
		metricLabel?: string;
		height?: number;
	}

	const { series, metricLabel = 'Change', height = 300 }: Props = $props();

	const POS_COLOR = '#10b981'; // emerald-500
	const NEG_COLOR = '#e11d48'; // rose-600

	const points = $derived(
		series
			.slice()
			.sort((a, b) => a.year - b.year)
			.filter((p) => Number.isFinite(p.pct))
	);
	const hasData = $derived(points.length > 0);

	// Symmetric y-axis around zero so positive and negative swings are visually
	// comparable. Round up to the next whole percent for tidy gridlines.
	const maxAbs = $derived(Math.max(1, ...points.map((p) => Math.abs(p.pct))));
	const yMax = $derived(Math.ceil(maxAbs));

	const WIDTH = 560;
	const PAD_L = 48;
	const PAD_R = 8;
	const PAD_T = 8;
	const PAD_B = 22;
	const chartW = $derived(WIDTH - PAD_L - PAD_R);
	const chartH = $derived(height - PAD_T - PAD_B);

	// Y coord for value `v` where v ∈ [-yMax, yMax].
	function yFor(v: number): number {
		const frac = (v + yMax) / (2 * yMax); // 0..1
		return PAD_T + chartH - frac * chartH;
	}

	// Bar X positions: even slots across the series, with small horizontal padding.
	const barWidth = $derived.by(() => {
		if (points.length === 0) return 0;
		const slot = chartW / points.length;
		return Math.max(3, Math.min(36, slot * 0.7));
	});
	function xCenterFor(i: number): number {
		const slot = chartW / Math.max(points.length, 1);
		return PAD_L + slot * (i + 0.5);
	}

	const bars = $derived(
		points.map((p, i) => {
			const x = xCenterFor(i);
			const zeroY = yFor(0);
			const valueY = yFor(p.pct);
			const top = Math.min(zeroY, valueY);
			const h = Math.abs(valueY - zeroY);
			return {
				x: x - barWidth / 2,
				y: top,
				width: barWidth,
				height: Math.max(h, 0.5),
				color: p.pct >= 0 ? POS_COLOR : NEG_COLOR,
				year: p.year,
				pct: p.pct
			};
		})
	);

	// Five evenly-spaced gridlines across [-yMax, yMax].
	const gridLines = $derived(
		[1, 0.5, 0, -0.5, -1].map((frac) => {
			const v = yMax * frac;
			return {
				y: yFor(v),
				label: `${v > 0 ? '+' : ''}${v.toFixed(0)}%`,
				isZero: v === 0
			};
		})
	);

	// Year labels: always show, but thin if crowded.
	const yearTicks = $derived.by(() => {
		if (points.length === 0) return [] as Array<{ year: number; x: number }>;
		const step = points.length <= 8 ? 1 : Math.ceil(points.length / 6);
		return points
			.map((p, i) => ({ year: p.year, x: xCenterFor(i), i }))
			.filter(({ i }) => i % step === 0 || i === points.length - 1);
	});
</script>

<div class="card flex flex-col gap-2" style="padding: 16px;">
	{#if !hasData}
		<div class="text-sm text-slate-400 py-6 text-center">
			Not enough data to compute year-over-year change
		</div>
	{:else}
		<svg
			viewBox="0 0 {WIDTH} {height}"
			preserveAspectRatio="none"
			style="height: {height}px; width: 100%;"
			aria-label="{metricLabel} year-over-year percent change"
		>
			<!-- Gridlines + % labels. Zero baseline is drawn darker. -->
			{#each gridLines as g, i (i)}
				<line
					x1={PAD_L}
					x2={WIDTH - PAD_R}
					y1={g.y}
					y2={g.y}
					stroke={g.isZero ? '#94a3b8' : 'var(--color-brand-100, #e2e8f0)'}
					stroke-width={g.isZero ? 1.25 : 1}
					vector-effect="non-scaling-stroke"
				/>
				<text
					x={PAD_L - 6}
					y={g.y}
					text-anchor="end"
					dominant-baseline="middle"
					font-size="9"
					fill={g.isZero ? '#64748b' : '#94a3b8'}
					font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
				>
					{g.label}
				</text>
			{/each}

			<!-- Bars -->
			{#each bars as b, i (i)}
				<rect x={b.x} y={b.y} width={b.width} height={b.height} fill={b.color} rx="1">
					<title>{metricLabel} {b.year}: {b.pct >= 0 ? '+' : ''}{b.pct.toFixed(1)}%</title>
				</rect>
			{/each}

			<!-- Year labels along the bottom -->
			{#each yearTicks as t (t.year)}
				<text
					x={t.x}
					y={height - 6}
					text-anchor="middle"
					font-size="10"
					fill="#94a3b8"
					font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
				>
					{t.year}
				</text>
			{/each}
		</svg>
	{/if}
</div>
