<script lang="ts" generics="T extends string">
	// iOS segmented control — ported from screens.jsx Segmented.
	// The pill-shaped selector slides under the active option via a CSS transition
	// on `left`, matching the iOS spring.

	interface Option<U extends string> {
		value: U;
		label: string;
	}

	interface Props {
		options: Array<Option<T>>;
		value: T;
		onSelect: (v: T) => void;
		/** Smaller variant for header chrome. Defaults to false (form-row sizing). */
		compact?: boolean;
	}

	let { options, value, onSelect, compact = false }: Props = $props();

	let idx = $derived(Math.max(0, options.findIndex((o) => o.value === value)));

	// Size tokens — single source of truth for default vs compact.
	let outerHeight = $derived(compact ? 30 : 44);
	let outerRadius = $derived(compact ? 11 : 14);
	let innerPad = $derived(compact ? 2 : 3);
	let pillRadius = $derived(compact ? 9 : 11);
	let fontSize = $derived(compact ? 10 : 13);
	let buttonPad = $derived(compact ? 2 : 8);
</script>

<div
	class="relative flex"
	style="
		height: {outerHeight}px;
		border-radius: {outerRadius}px;
		background: rgba(30,30,40,0.06);
		padding: {innerPad}px;
		border: 0.5px solid rgba(30,30,40,0.08);
	"
>
	<div
		class="absolute"
		style="
			top: {innerPad}px; bottom: {innerPad}px;
			left: calc({(idx / options.length) * 100}% + {innerPad}px);
			width: calc({100 / options.length}% - {innerPad * 2}px);
			border-radius: {pillRadius}px;
			background: rgba(255,255,255,0.95);
			box-shadow: 0 1px 3px rgba(16,24,40,0.12), 0 0.5px 0 rgba(255,255,255,0.9) inset;
			transition: left 260ms cubic-bezier(0.32,0.72,0,1);
		"
	></div>
	{#each options as o (o.value)}
		<button
			type="button"
			onclick={() => onSelect(o.value)}
			class="flex-1 relative z-10 border-0 bg-transparent cursor-pointer"
			style="
				font-family: var(--font-sans);
				font-size: {fontSize}px;
				font-weight: 600;
				color: {o.value === value ? 'var(--ink)' : 'rgba(30,30,40,0.55)'};
				letter-spacing: -0.1px;
				transition: color 180ms;
				padding: 0 {buttonPad}px;
				white-space: nowrap;
			"
		>
			{o.label}
		</button>
	{/each}
</div>
