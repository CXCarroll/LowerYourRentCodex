<script lang="ts">
	// Simple bar chart in SVG. Used for hourly / daily submission counts.
	// Empty-data state shows a muted "no activity" message.

	interface Bucket {
		x: string; // label for x-axis (tooltip / first+last labels)
		y: number;
	}

	interface Props {
		buckets: Bucket[];
		title?: string;
		height?: number;
	}

	const { buckets, title, height = 120 }: Props = $props();

	const maxY = $derived(Math.max(1, ...buckets.map((b) => b.y)));
	const hasData = $derived(buckets.some((b) => b.y > 0));
</script>

<div class="card flex flex-col gap-2" style="padding: 16px;">
	{#if title}
		<div class="text-xs uppercase tracking-wide text-slate-500">{title}</div>
	{/if}
	{#if buckets.length === 0}
		<div class="text-sm text-slate-400 py-6 text-center">No data</div>
	{:else}
		<svg
			viewBox="0 0 {buckets.length * 10} {height}"
			preserveAspectRatio="none"
			style="height: {height}px; width: 100%;"
			aria-label={title ?? 'bar chart'}
		>
			{#each buckets as b, i (i)}
				{@const barH = (b.y / maxY) * (height - 8)}
				<rect
					x={i * 10 + 1}
					y={height - barH}
					width={8}
					height={barH}
					fill={b.y > 0 ? 'var(--color-brand-600)' : 'var(--color-brand-100)'}
					rx={1}
				>
					<title>{b.x}: {b.y}</title>
				</rect>
			{/each}
		</svg>
		<div class="flex justify-between text-[10px] text-slate-400 font-mono">
			<span>{buckets[0]?.x}</span>
			<span>{buckets[buckets.length - 1]?.x}</span>
		</div>
		{#if !hasData}
			<div class="text-xs text-slate-400">No activity in this window</div>
		{/if}
	{/if}
</div>
