<script lang="ts">
	// Horizontal rent-range gauge with tick markers. Range is low → current; the filled
	// portion is low → median. Matches screens.jsx RentGauge + GaugeTick.
	import { formatCentsAsDollars } from '$lib/shared/format';

	interface Props {
		currentCents: number;
		lowCents: number;
		targetCents: number;
		walkCents: number;
		medianCents: number;
	}

	let { currentCents, lowCents, targetCents, walkCents, medianCents }: Props = $props();

	let span = $derived(currentCents - lowCents || 1);
	function pos(v: number): number {
		return Math.max(0, Math.min(100, ((v - lowCents) / span) * 100));
	}

	interface Tick {
		position: number;
		label: string;
		color: string;
		bold?: boolean;
		right?: boolean;
	}

	let ticks = $derived<Tick[]>([
		{ position: 0, label: 'Ask', color: 'var(--accent-deep)', bold: true },
		{ position: pos(targetCents), label: 'Target', color: 'rgba(30,30,40,0.6)' },
		{ position: pos(walkCents), label: 'Walk', color: 'rgba(30,30,40,0.6)' },
		{ position: 100, label: 'Now', color: 'rgba(30,30,40,0.85)', bold: true, right: true }
	]);

	let fillPct = $derived(pos(medianCents));
</script>

<div class="mt-5">
	<div
		class="relative"
		style="height: 8px; border-radius: 4px; background: rgba(30,30,40,0.06);"
	>
		<div
			class="absolute left-0 top-0 bottom-0 rounded"
			style="
				width: {fillPct}%;
				background: linear-gradient(90deg, var(--accent-deep), var(--accent-mid));
				border-radius: 4px;
			"
		></div>
		{#each ticks as t (t.label)}
			<div
				class="absolute flex flex-col items-center"
				style="
					top: -4px;
					left: {t.position}%;
					transform: {t.right ? 'translateX(-100%)' : 'translateX(-50%)'};
				"
			>
				<div
					style="width: 2px; height: 16px; background: {t.color}; border-radius: 1px;"
				></div>
				<div
					style="
						font-family: var(--font-mono);
						font-size: 9px;
						letter-spacing: 0.6px;
						color: {t.color};
						margin-top: 4px;
						text-transform: uppercase;
						font-weight: {t.bold ? 700 : 500};
						white-space: nowrap;
					"
				>
					{t.label}
				</div>
			</div>
		{/each}
	</div>
	<div
		class="flex justify-between mt-6"
		style="font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.3px; color: rgba(30,30,40,0.5);"
	>
		<span>{formatCentsAsDollars(lowCents)}</span>
		<span>{formatCentsAsDollars(currentCents)}</span>
	</div>
</div>
