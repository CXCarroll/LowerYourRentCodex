<script lang="ts">
	// Full-width primary button with accent gradient + press animation + optional spinner.
	// Ported from screens.jsx PrimaryButton.

	import { reducedMotion } from '$lib/stores/motion.svelte';

	interface Props {
		onClick?: () => void;
		disabled?: boolean;
		loading?: boolean;
		type?: 'button' | 'submit';
		children: import('svelte').Snippet;
	}

	let {
		onClick,
		disabled = false,
		loading = false,
		type = 'button',
		children
	}: Props = $props();

	let press = $state(false);
</script>

<button
	{type}
	onclick={onClick}
	disabled={disabled || loading}
	onpointerdown={() => (press = true)}
	onpointerup={() => (press = false)}
	onpointerleave={() => (press = false)}
	class="lyr-motion relative w-full border-0"
	style="
		height: 54px;
		border-radius: 16px;
		cursor: {disabled || loading ? 'default' : 'pointer'};
		background: {disabled
		? 'rgba(30,30,40,0.1)'
		: 'linear-gradient(180deg, var(--accent-mid) 0%, var(--accent-deep) 100%)'};
		color: white;
		font-family: var(--font-sans);
		font-size: 16px;
		font-weight: 600;
		letter-spacing: -0.1px;
		box-shadow: {disabled
		? 'none'
		: '0 0.5px 0 rgba(255,255,255,0.35) inset, 0 -0.5px 0 rgba(0,0,0,0.15) inset, 0 8px 20px -6px var(--accent-mid), 0 2px 4px rgba(16,24,40,0.12)'};
		transform: {press && !reducedMotion.enabled ? 'scale(0.98)' : 'scale(1)'};
		transition: transform 120ms, box-shadow 180ms;
	"
>
	<span
		class="inline-flex items-center justify-center gap-2"
		style="opacity: {loading ? 0.6 : 1}"
	>
		{#if loading}
			<svg
				width="16"
				height="16"
				viewBox="0 0 16 16"
				class="lyr-spinner"
				style="animation: lyr-spin 0.8s linear infinite;"
			>
				<circle cx="8" cy="8" r="6" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="2" />
				<path
					d="M14 8a6 6 0 00-6-6"
					stroke="white"
					stroke-width="2"
					fill="none"
					stroke-linecap="round"
				/>
			</svg>
		{/if}
		{@render children()}
	</span>
</button>
