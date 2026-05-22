<script lang="ts">
	// Atmospheric backdrop — 4 palettes of gradient base + 3 floating color orbs +
	// a subtle SVG grain. Ported from screens.jsx / GlassBackdrop.

	import { tweaks, type Palette } from '$lib/stores/tweaks.svelte';

	const PRESETS: Record<
		Palette,
		{ base: string; orbs: Array<{ c: string; x: string; y: string; s: number }> }
	> = {
		sage: {
			base: 'linear-gradient(180deg, #EDF2EA 0%, #F4EFE6 45%, #E6E9EF 100%)',
			orbs: [
				{ c: 'rgba(120, 168, 120, 0.55)', x: '-10%', y: '-8%', s: 420 },
				{ c: 'rgba(214, 186, 140, 0.55)', x: '70%', y: '18%', s: 360 },
				{ c: 'rgba(148, 168, 196, 0.5)', x: '30%', y: '78%', s: 440 }
			]
		},
		dusk: {
			base: 'linear-gradient(180deg, #E8E4F0 0%, #F0E6EC 50%, #DCE0EC 100%)',
			orbs: [
				{ c: 'rgba(168, 140, 204, 0.55)', x: '-10%', y: '0%', s: 420 },
				{ c: 'rgba(232, 168, 184, 0.55)', x: '65%', y: '20%', s: 360 },
				{ c: 'rgba(120, 152, 196, 0.55)', x: '30%', y: '80%', s: 440 }
			]
		},
		sunset: {
			base: 'linear-gradient(180deg, #F5E8DC 0%, #F2DCD8 50%, #E8DCE8 100%)',
			orbs: [
				{ c: 'rgba(240, 160, 120, 0.6)', x: '-10%', y: '-5%', s: 420 },
				{ c: 'rgba(232, 188, 128, 0.55)', x: '65%', y: '25%', s: 360 },
				{ c: 'rgba(196, 140, 180, 0.5)', x: '30%', y: '80%', s: 440 }
			]
		},
		mono: {
			base: 'linear-gradient(180deg, #EEEEEF 0%, #E8E8EA 50%, #DEDEE2 100%)',
			orbs: [
				{ c: 'rgba(140,140,148,0.35)', x: '-10%', y: '-5%', s: 420 },
				{ c: 'rgba(180,180,188,0.35)', x: '65%', y: '25%', s: 360 },
				{ c: 'rgba(120,120,130,0.3)', x: '30%', y: '80%', s: 440 }
			]
		}
	};

	let p = $derived(PRESETS[tweaks.palette]);

	// Pre-encoded SVG noise: a 160x160 fractal-noise tile @ opacity 0.35 overlay.
	// Identical to screens.jsx GlassBackdrop.
	const GRAIN_BG =
		`url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.35 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`;
</script>

<div
	aria-hidden="true"
	class="fixed inset-0 -z-10 overflow-hidden"
	style="background: {p.base};"
>
	{#each p.orbs as orb, i (i)}
		<div
			class="lyr-backdrop-orb absolute rounded-full"
			style="
				width: {orb.s}px;
				height: {orb.s}px;
				left: {orb.x};
				top: {orb.y};
				filter: blur(40px);
				background: radial-gradient(circle, {orb.c} 0%, rgba(0,0,0,0) 65%);
				animation: lyr-float-{i} {16 + i * 4}s ease-in-out infinite alternate;
			"
		></div>
	{/each}
	<div
		class="absolute inset-0"
		style="opacity: 0.35; mix-blend-mode: overlay; background-image: {GRAIN_BG};"
	></div>
</div>
