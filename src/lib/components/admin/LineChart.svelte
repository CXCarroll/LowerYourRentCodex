<script lang="ts">
	// Simple line chart for daily counts over a window. Filled area under the
	// line, muted gridline at max, first/last date labels.

	interface Point {
		x: string;
		y: number;
	}

	interface Props {
		points: Point[];
		title?: string;
		height?: number;
	}

	const { points, title, height = 160 }: Props = $props();
	const uid = $props.id();

	const maxY = $derived(Math.max(1, ...points.map((p) => p.y)));
	const hasData = $derived(points.some((p) => p.y > 0));
	const chartTitle = $derived(title ?? 'Line chart');
	const chartTitleId = $derived(`${uid}-title`);
	const chartDescId = $derived(`${uid}-desc`);
	const chartDesc = $derived.by(() => {
		if (points.length === 0) return `${chartTitle} has no data points.`;
		const first = points[0].x;
		const last = points[points.length - 1].x;
		if (!hasData) return `${chartTitle} from ${first} to ${last}; no submissions in this window.`;
		return `${chartTitle} from ${first} to ${last}; peak value is ${maxY}. Full data is available in the table below.`;
	});

	const WIDTH = 400;
	const PAD_B = 18;
	const chartH = $derived(height - PAD_B);

	const coords = $derived.by(() =>
		points.map((p, i) => {
			const x = points.length > 1 ? (i / (points.length - 1)) * WIDTH : WIDTH / 2;
			const y = chartH - (p.y / maxY) * (chartH - 4);
			return { x, y };
		})
	);

	const linePath = $derived(
		coords.length > 0
			? 'M ' + coords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' L ')
			: ''
	);

	const areaPath = $derived(
		coords.length > 0
			? `M ${coords[0].x.toFixed(2)},${chartH} L ` +
				coords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' L ') +
				` L ${coords[coords.length - 1].x.toFixed(2)},${chartH} Z`
			: ''
	);
</script>

<div class="card flex flex-col gap-2" style="padding: 16px;">
	{#if title}
		<div class="text-xs uppercase tracking-wide text-slate-500 flex justify-between">
			<span>{title}</span>
			<span class="text-slate-400 font-mono">peak {maxY}</span>
		</div>
	{/if}
	{#if points.length === 0}
		<div class="text-sm text-slate-400 py-6 text-center">No data</div>
	{:else}
		<svg
			role="img"
			viewBox="0 0 {WIDTH} {height}"
			preserveAspectRatio="none"
			style="height: {height}px; width: 100%;"
			aria-labelledby="{chartTitleId} {chartDescId}"
		>
			<title id={chartTitleId}>{chartTitle}</title>
			<desc id={chartDescId}>{chartDesc}</desc>

			<!-- axis baseline -->
			<line
				x1={0}
				x2={WIDTH}
				y1={chartH}
				y2={chartH}
				stroke="var(--color-brand-100)"
				stroke-width={1}
				vector-effect="non-scaling-stroke"
			/>
			<path d={areaPath} fill="var(--color-brand-50)" />
			<path
				d={linePath}
				fill="none"
				stroke="var(--color-brand-600)"
				stroke-width={1.75}
				stroke-linejoin="round"
				stroke-linecap="round"
				vector-effect="non-scaling-stroke"
			/>
			{#each coords as c, i (i)}
				<circle cx={c.x} cy={c.y} r={2} fill="var(--color-brand-700)">
					<title>{points[i].x}: {points[i].y}</title>
				</circle>
			{/each}
		</svg>
		<div class="flex justify-between text-[10px] text-slate-400 font-mono">
			<span>{points[0].x}</span>
			<span>{points[points.length - 1].x}</span>
		</div>
		{#if !hasData}
			<div class="text-xs text-slate-400">No submissions in this window</div>
		{/if}
		<details class="mt-1 text-sm text-slate-600">
			<summary class="cursor-pointer text-xs font-medium text-slate-600">
				View {chartTitle} data
			</summary>
			<div class="mt-2 overflow-x-auto">
				<table class="w-full text-sm">
					<caption class="sr-only">{chartTitle} data</caption>
					<thead>
						<tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
							<th scope="col" class="py-2 pr-4 font-medium">Date</th>
							<th scope="col" class="py-2 text-right font-medium">Submissions</th>
						</tr>
					</thead>
					<tbody>
						{#each points as point (point.x)}
							<tr class="border-b border-slate-100 last:border-0">
								<th scope="row" class="py-2 pr-4 text-left font-medium text-slate-900">
									{point.x}
								</th>
								<td class="py-2 text-right tabular-nums text-slate-700">{point.y}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>
	{/if}
</div>
