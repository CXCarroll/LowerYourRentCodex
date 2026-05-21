<script lang="ts">
	// iOS-style glass input with optional prefix (e.g. serif "$" for rent).
	// Matches screens.jsx GlassInput.

	interface Props {
		value: string;
		onValue: (v: string) => void;
		placeholder?: string;
		type?: string;
		inputmode?: 'text' | 'numeric' | 'tel' | 'decimal' | 'email' | 'search' | 'url';
		autocomplete?: string;
		prefix?: string;
		id?: string;
		name?: string;
		ariaInvalid?: boolean;
		ariaLabelledby?: string;
		ariaDescribedby?: string;
		ariaErrormessage?: string;
		inputFontSize?: number;
		/** Optional bindable ref to the native <input> for callers that need
		 *  direct DOM access (e.g. caret control). Most callers can ignore it. */
		inputRef?: HTMLInputElement;
	}

	let {
		value,
		onValue,
		placeholder,
		type = 'text',
		inputmode,
		autocomplete,
		prefix,
		id,
		name,
		ariaInvalid,
		ariaLabelledby,
		ariaDescribedby,
		ariaErrormessage,
		inputFontSize,
		inputRef = $bindable()
	}: Props = $props();

	let focus = $state(false);
	const isDate = $derived(type === 'date');
	const computedFontSize = $derived(inputFontSize ?? (isDate ? 13 : 17));
</script>

<div
	class="glass-input-shell relative flex items-center min-w-0"
	style="
		height: 52px;
		border-radius: 16px;
		overflow: hidden;
		background: rgba(255,255,255,{focus ? 0.85 : 0.55});
		border: 0.5px solid {focus ? 'var(--hairline-strong)' : 'var(--hairline)'};
		box-shadow: {focus
			? 'inset 0 1px 0 rgba(255,255,255,0.9), 0 0 0 4px rgba(30,30,40,0.06)'
			: 'inset 0 1px 0 rgba(255,255,255,0.9)'};
		transition: all 180ms ease;
	"
>
	{#if prefix}
		<span
			class="font-serif"
			style="font-family: var(--font-serif); font-size: 22px; color: rgba(30,30,40,0.45); padding-left: 18px; padding-right: 2px;"
		>
			{prefix}
		</span>
	{/if}
	<input
		bind:this={inputRef}
		{id}
		{name}
		{type}
		{placeholder}
		inputmode={inputmode}
		autocomplete={autocomplete as never}
		{value}
		aria-invalid={ariaInvalid ? 'true' : undefined}
		aria-labelledby={ariaLabelledby}
		aria-describedby={ariaDescribedby}
		aria-errormessage={ariaErrormessage}
		oninput={(e) => onValue((e.target as HTMLInputElement).value)}
		onfocus={() => (focus = true)}
		onblur={() => (focus = false)}
		class="flex-1 min-w-0 w-full h-full border-0"
		style="
			padding: {prefix ? '0 10px 0 0' : isDate ? '0 8px' : '0 18px'};
			background: transparent;
			font-family: var(--font-sans);
			font-size: {computedFontSize}px;
			font-weight: 500;
			color: var(--ink);
			letter-spacing: -0.2px;
		"
	/>
</div>
