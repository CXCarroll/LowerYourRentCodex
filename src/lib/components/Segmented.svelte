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
		name: string;
		legend: string;
		value: T;
		onSelect: (v: T) => void;
		/** Smaller variant for constrained chrome. Defaults to false (form-row sizing). */
		compact?: boolean;
	}

	let { options, name, legend, value, onSelect, compact = false }: Props = $props();

	let idx = $derived(Math.max(0, options.findIndex((o) => o.value === value)));

	// Size tokens — single source of truth for default vs compact.
	let outerHeight = $derived(compact ? 30 : 44);
	let outerRadius = $derived(compact ? 11 : 14);
	let innerPad = $derived(compact ? 2 : 3);
	let pillRadius = $derived(compact ? 9 : 11);
	let fontSize = $derived(compact ? 10 : 13);
	let buttonPad = $derived(compact ? 2 : 8);
</script>

<fieldset
	class="relative flex"
	style="
		height: {outerHeight}px;
		border-radius: {outerRadius}px;
		background: rgba(30,30,40,0.06);
		padding: {innerPad}px;
		border: 0.5px solid rgba(30,30,40,0.08);
		margin: 0;
		min-inline-size: 0;
	"
>
	<legend class="sr-only">{legend}</legend>
	<div
		class="lyr-motion absolute"
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
		<label
			class="segmented-option flex-1 relative z-10 cursor-pointer"
			style="
				border-radius: {pillRadius}px;
			"
		>
			<input
				class="segmented-input"
				type="radio"
				{name}
				value={o.value}
				checked={o.value === value}
				onchange={() => onSelect(o.value)}
			/>
			<span
				class="segmented-label lyr-motion"
				style="
					font-family: var(--font-sans);
					font-size: {fontSize}px;
					font-weight: 600;
					color: {o.value === value ? 'var(--ink)' : 'rgba(30,30,40,0.72)'};
					letter-spacing: 0;
					transition: color 180ms;
					padding: 0 {buttonPad}px;
					white-space: nowrap;
					border-radius: {pillRadius}px;
				"
			>
				{o.label}
			</span>
		</label>
	{/each}
</fieldset>

<style>
	.segmented-option {
		display: flex;
		align-items: stretch;
		justify-content: center;
		min-width: 0;
	}

	.segmented-input {
		position: absolute;
		inset: 0;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}

	.segmented-label {
		position: relative;
		z-index: 1;
		display: flex;
		width: 100%;
		align-items: center;
		justify-content: center;
		text-align: center;
		pointer-events: none;
	}

	.segmented-input:focus-visible + .segmented-label {
		outline: 2px solid color-mix(in srgb, var(--accent, #0f62fe) 72%, white);
		outline-offset: -2px;
	}
</style>
