<script lang="ts">
	// Stat card: big number, label, and a 32px sparkline underneath.
	// Uses the admin brand palette (green) — no glass tokens.

	interface Props {
		label: string;
		value: number;
		series?: number[]; // optional sparkline data
	}

	const { label, value, series = [] }: Props = $props();

	const points = $derived.by(() => {
		if (series.length < 2) return '';
		const max = Math.max(...series, 1);
		const min = Math.min(...series, 0);
		const range = max - min || 1;
		const w = 100;
		const h = 32;
		return series
			.map((v, i) => {
				const x = (i / (series.length - 1)) * w;
				const y = h - ((v - min) / range) * h;
				return `${x.toFixed(2)},${y.toFixed(2)}`;
			})
			.join(' ');
	});

	const display = $derived(value.toLocaleString('en-US'));
</script>

<div class="card flex flex-col gap-2" style="padding: 18px;">
	<div class="text-xs uppercase tracking-wide text-slate-500">{label}</div>
	<div class="text-3xl font-semibold text-slate-900">{display}</div>
	{#if series.length >= 2}
		<svg
			viewBox="0 0 100 32"
			preserveAspectRatio="none"
			style="height: 32px; width: 100%;"
			aria-hidden="true"
		>
			<polyline
				{points}
				fill="none"
				stroke="var(--color-brand-600)"
				stroke-width="1.5"
				stroke-linejoin="round"
				stroke-linecap="round"
				vector-effect="non-scaling-stroke"
			/>
		</svg>
	{/if}
</div>
