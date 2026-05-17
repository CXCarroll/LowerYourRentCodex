<script lang="ts">
	// Multi-series line chart: HUD FMR over time, one line per apt type.
	// Hand-rolled SVG to stay dependency-free, mirroring LineChart.svelte.

	import { APT_TYPES, APT_TYPE_LABEL, type AptType } from '$lib/shared/apt-types';
	import { formatCentsAsDollars } from '$lib/shared/format';

	interface Props {
		seriesByAptType: Record<AptType, Array<{ year: number; cents: number }>>;
		height?: number;
	}

	const { seriesByAptType, height = 300 }: Props = $props();

	// Distinct hues so every line is readable against the card background.
	// Order matches APT_TYPES: studio, 1br, 2br, 3br, 4br_plus.
	const COLORS: Record<AptType, string> = {
		studio: '#64748b', // slate-500
		'1br': '#10b981', // emerald-500
		'2br': '#2563eb', // blue-600 — headline series
		'3br': '#f59e0b', // amber-500
		'4br_plus': '#e11d48' // rose-600
	};

	const shortLabel: Record<AptType, string> = {
		studio: 'Studio',
		'1br': '1 BR',
		'2br': '2 BR',
		'3br': '3 BR',
		'4br_plus': '4+ BR'
	};

	const allPoints = $derived(
		APT_TYPES.flatMap((t) => seriesByAptType[t] ?? []).filter((p) => Number.isFinite(p.cents))
	);
	const hasData = $derived(allPoints.length > 0);

	const years = $derived(Array.from(new Set(allPoints.map((p) => p.year))).sort((a, b) => a - b));
	const minYear = $derived(years[0] ?? 0);
	const maxYear = $derived(years[years.length - 1] ?? 0);

	// Y-axis max, rounded up to next $100 for tidy gridlines. At least $100.
	const maxCents = $derived(Math.max(10_000, ...allPoints.map((p) => p.cents)));
	const yMax = $derived(Math.ceil(maxCents / 10_000) * 10_000);

	// SVG geometry. Left pad for Y-axis labels, bottom pad for year labels.
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
	function yFor(cents: number): number {
		return PAD_T + chartH - (cents / yMax) * chartH;
	}

	interface LineDatum {
		aptType: AptType;
		color: string;
		path: string;
		points: Array<{ x: number; y: number; year: number; cents: number }>;
	}

	const lines = $derived.by<LineDatum[]>(() =>
		APT_TYPES.map((t) => {
			const series = (seriesByAptType[t] ?? [])
				.slice()
				.sort((a, b) => a.year - b.year)
				.filter((p) => Number.isFinite(p.cents));
			const points = series.map((p) => ({
				x: xFor(p.year),
				y: yFor(p.cents),
				year: p.year,
				cents: p.cents
			}));
			const path =
				points.length > 0
					? 'M ' + points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L ')
					: '';
			return { aptType: t, color: COLORS[t], path, points };
		}).filter((l) => l.points.length > 0)
	);

	// Gridlines at 0, 25%, 50%, 75%, 100% of yMax.
	const gridLines = $derived(
		[0, 0.25, 0.5, 0.75, 1].map((frac) => {
			const cents = yMax * frac;
			return {
				y: yFor(cents),
				label: formatCentsAsDollars(Math.round(cents))
			};
		})
	);

	// Year tick labels: show all if ≤ 6, otherwise first, middle, last.
	const yearTicks = $derived.by(() => {
		if (years.length === 0) return [] as number[];
		if (years.length <= 6) return years;
		const mid = years[Math.floor(years.length / 2)];
		return [years[0], mid, years[years.length - 1]];
	});
</script>

<div class="card flex flex-col gap-2" style="padding: 16px;">
	{#if !hasData}
		<div class="text-sm text-slate-400 py-6 text-center">No historical FMR data</div>
	{:else}
		<!-- Legend -->
		<div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
			{#each APT_TYPES as t (t)}
				{#if (seriesByAptType[t] ?? []).length > 0}
					<span class="inline-flex items-center gap-1.5">
						<span
							class="inline-block rounded-full"
							style="width: 8px; height: 8px; background: {COLORS[t]};"
							aria-hidden="true"
						></span>
						<span>{shortLabel[t]}</span>
					</span>
				{/if}
			{/each}
		</div>

		<svg
			viewBox="0 0 {WIDTH} {height}"
			preserveAspectRatio="none"
			style="height: {height}px; width: 100%;"
			aria-label="HUD FMR history by apartment type"
		>
			<!-- Gridlines + Y labels -->
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

			<!-- One line per apt type -->
			{#each lines as line (line.aptType)}
				<path
					d={line.path}
					fill="none"
					stroke={line.color}
					stroke-width={1.75}
					stroke-linejoin="round"
					stroke-linecap="round"
					vector-effect="non-scaling-stroke"
				/>
				{#each line.points as p, i (i)}
					<circle cx={p.x} cy={p.y} r={2.25} fill={line.color}>
						<title
							>{APT_TYPE_LABEL[line.aptType]}: {formatCentsAsDollars(p.cents)} ({p.year})</title
						>
					</circle>
				{/each}
			{/each}

			<!-- Year tick labels -->
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
