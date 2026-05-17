<script lang="ts">
	// Dev-only design tweaks panel — matches the prototype's Tweaks panel.
	// Mutates the `tweaks` state; an $effect in the root layout applies to :root
	// and persists to localStorage.

	import { tweaks, PALETTES, ACCENT_HUES } from '$lib/stores/tweaks.svelte';

	let open = $state(false);

	function toggle() {
		open = !open;
		try {
			localStorage.setItem('lyr:tweaks:open', open ? '1' : '0');
		} catch {
			/* noop */
		}
	}

	$effect(() => {
		try {
			open = localStorage.getItem('lyr:tweaks:open') === '1';
		} catch {
			/* noop */
		}
	});
</script>

<!-- Edge handle -->
<button
	type="button"
	aria-label={open ? 'Close design tweaks' : 'Open design tweaks'}
	aria-expanded={open}
	onclick={toggle}
	class="fixed bottom-5 right-5 z-50 flex items-center gap-1.5 rounded-full border-0 cursor-pointer"
	style="
		padding: 10px 16px;
		background: rgba(22,22,28,0.78);
		backdrop-filter: blur(24px) saturate(160%);
		-webkit-backdrop-filter: blur(24px) saturate(160%);
		border: 0.5px solid rgba(255,255,255,0.1);
		box-shadow: 0 10px 24px -8px rgba(0,0,0,0.35);
		color: white;
		font-family: var(--font-sans);
		font-size: 12px;
		font-weight: 600;
		letter-spacing: -0.1px;
	"
>
	<span
		class="inline-block rounded-full"
		style="width: 10px; height: 10px; background: linear-gradient(135deg, var(--accent-mid), var(--accent-deep));"
	></span>
	{open ? 'Close tweaks' : 'Design tweaks'}
</button>

{#if open}
	<aside
		class="fixed z-40 rounded-[20px]"
		style="
			right: 20px; bottom: 72px; width: 280px; padding: 18px;
			background: rgba(22,22,28,0.78);
			backdrop-filter: blur(24px) saturate(160%);
			-webkit-backdrop-filter: blur(24px) saturate(160%);
			border: 0.5px solid rgba(255,255,255,0.1);
			box-shadow: 0 30px 60px -20px rgba(0,0,0,0.5);
			color: white;
			font-family: var(--font-sans);
			font-size: 13px;
		"
	>
		<div
			class="mb-3.5"
			style="font-family: var(--font-mono); font-size: 10px; letter-spacing: 1.4px; color: rgba(255,255,255,0.5); text-transform: uppercase;"
		>
			Tweaks
		</div>

		<!-- Backdrop palette -->
		<div class="mb-3.5">
			<div class="mb-2" style="font-size: 11px; color: rgba(255,255,255,0.55);">
				Backdrop palette
			</div>
			<div class="grid grid-cols-2 gap-1.5">
				{#each PALETTES as p (p.id)}
					<button
						type="button"
						onclick={() => (tweaks.palette = p.id)}
						class="flex items-center gap-2 cursor-pointer"
						style="
							padding: 8px;
							border-radius: 10px;
							background: rgba(255,255,255,{tweaks.palette === p.id ? 0.15 : 0.05});
							border: 0.5px solid rgba(255,255,255,{tweaks.palette === p.id ? 0.3 : 0.08});
							color: white;
							font-size: 12px;
							font-weight: 500;
						"
					>
						<span
							class="flex-shrink-0"
							style="width: 20px; height: 20px; border-radius: 6px; background: {p.swatch};"
						></span>
						{p.label}
					</button>
				{/each}
			</div>
		</div>

		<!-- Accent hue -->
		<div class="mb-3.5">
			<div class="mb-2" style="font-size: 11px; color: rgba(255,255,255,0.55);">Accent</div>
			<div class="flex gap-1.5">
				{#each ACCENT_HUES as h (h.h)}
					<button
						type="button"
						title={h.name}
						onclick={() => (tweaks.accentHue = h.h)}
						class="cursor-pointer"
						style="
							width: 30px; height: 30px; border-radius: 8px;
							background: oklch(0.55 0.13 {h.h});
							border: 1.5px solid {tweaks.accentHue === h.h ? 'white' : 'transparent'};
							box-shadow: {tweaks.accentHue === h.h ? '0 0 0 1px rgba(0,0,0,0.3)' : 'none'};
						"
						aria-label={h.name}
					></button>
				{/each}
			</div>
		</div>

		<!-- Glass intensity -->
		<div>
			<div
				class="flex justify-between mb-1.5"
				style="font-size: 11px; color: rgba(255,255,255,0.55);"
			>
				<span>Glass intensity</span>
				<span style="font-family: var(--font-mono); color: rgba(255,255,255,0.5);">
					{tweaks.glassIntensity.toFixed(2)}
				</span>
			</div>
			<input
				type="range"
				min="0.25"
				max="0.9"
				step="0.05"
				value={tweaks.glassIntensity}
				oninput={(e) =>
					(tweaks.glassIntensity = parseFloat((e.target as HTMLInputElement).value))}
				class="w-full"
				style="accent-color: white;"
			/>
		</div>
	</aside>
{/if}
