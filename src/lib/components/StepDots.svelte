<script lang="ts">
	// 3-step progress indicator. The current step stretches to a pill; past steps stay
	// in the accent color; future steps are muted. Matches screens.jsx StepDots.
	interface Props {
		step: number; // 0, 1, or 2
	}
	let { step }: Props = $props();
</script>

<div class="flex items-center gap-1.5">
	{#each [0, 1, 2] as i (i)}
		<div
			style="
				width: {i === step ? 22 : 6}px;
				height: 6px;
				border-radius: 3px;
				background: {i <= step ? 'var(--accent-deep)' : 'rgba(30,30,40,0.15)'};
				transition: all 300ms;
			"
		></div>
	{/each}
</div>
