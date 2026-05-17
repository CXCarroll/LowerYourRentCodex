<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import GlassBackdrop from '$lib/components/GlassBackdrop.svelte';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import { tweaks, applyTweaksToRoot, persistTweaks } from '$lib/stores/tweaks.svelte';

	let { children } = $props();

	// /admin has its own chrome (see src/routes/admin/+layout.svelte). Render its pages
	// raw here so the glass backdrop doesn't bleed into the admin UI.
	let isAdmin = $derived(page.url.pathname === '/admin' || page.url.pathname.startsWith('/admin/'));

	// Apply tweaks to the DOM + persist them whenever they change. Single root-level
	// $effect so every page inherits the current design tokens. The in-page
	// TweaksPanel UI has been removed; the store remains so any saved palette
	// from earlier sessions still loads.
	$effect(() => {
		// Touch the individual properties so Svelte tracks them.
		tweaks.palette;
		tweaks.accentHue;
		tweaks.glassIntensity;
		applyTweaksToRoot();
		persistTweaks();
	});

	// ─── Top-level tab navigation ────────────────────────────────────────────
	// Three sibling sections of the app: Negotiate (home), Learn, Search.
	// Each is a real route so URLs are shareable + browser nav works; the
	// content area below the persistent header animates a horizontal slide
	// on tab change, direction determined by tab-index delta.
	type Tab = 'negotiate' | 'learn' | 'search';
	const TABS: Array<{ value: Tab; label: string; href: string }> = [
		{ value: 'negotiate', label: 'Negotiate', href: '/' },
		{ value: 'learn', label: 'Learn', href: '/learn' },
		{ value: 'search', label: 'Search', href: '/search' }
	];

	let activeTab = $derived<Tab>(
		page.url.pathname.startsWith('/learn')
			? 'learn'
			: page.url.pathname.startsWith('/search')
				? 'search'
				: 'negotiate'
	);

	function tabIndex(t: Tab): number {
		return TABS.findIndex((x) => x.value === t);
	}

	// Slide direction: +1 when moving rightward through the tab order
	// (new content flies in from the right), -1 when moving leftward.
	// prevTabIdx starts at -1 so the first $effect run just bootstraps it
	// without producing a phantom slide on initial render.
	let prevTabIdx = $state(-1);
	let slideDir = $state<1 | -1>(1);

	$effect(() => {
		const newIdx = tabIndex(activeTab);
		if (prevTabIdx === -1) {
			prevTabIdx = newIdx;
			return;
		}
		if (newIdx !== prevTabIdx) {
			slideDir = newIdx > prevTabIdx ? 1 : -1;
			prevTabIdx = newIdx;
		}
	});

	function onPickTab(v: Tab) {
		const t = TABS.find((x) => x.value === v);
		if (t && t.value !== activeTab) goto(t.href);
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Lower Your Rent</title>
</svelte:head>

{#if isAdmin}
	{@render children()}
{:else}
	<GlassBackdrop />
	<div class="relative z-0 min-h-dvh">
		<main class="mx-auto w-full max-w-[440px] px-5 pt-8 pb-16 sm:pt-12">
			<!-- Persistent header: brand mark + wordmark on the left, tab toggle
			     on the right. Lives in the layout so all three top-level
			     sections share identical chrome and the toggle position
			     doesn't shift between routes.
			     No inner horizontal padding — the header content aligns
			     flush with the form card's outer edge below (both inherit
			     the main container's px-5). `nowrap` on the wordmark keeps
			     "Lower Your Rent" on a single line at narrow widths. -->
			<div
				class="flex items-center"
				style="gap: 10px; margin-top: 2px; margin-bottom: 22px;"
			>
				<BrandMark />
				<span
					style="
						font-family: var(--font-sans);
						font-size: 22px;
						font-weight: 600;
						color: var(--ink);
						letter-spacing: -0.4px;
						white-space: nowrap;
					"
				>
					Lower Your Rent
				</span>
				<div class="ml-auto flex-shrink-0" style="min-width: 168px;">
					<Segmented
						compact
						options={TABS.map(({ value, label }) => ({ value, label }))}
						value={activeTab}
						onSelect={onPickTab}
					/>
				</div>
			</div>

			<!-- Sliding content area. CSS grid lets the outgoing + incoming
			     children stack at the same 1/1 cell during the ~280 ms cross
			     so they animate horizontally without layout reflow. -->
			<div class="grid">
				{#key page.url.pathname}
					<div
						class="col-start-1 row-start-1"
						in:fly={{ x: slideDir * 60, duration: 280, easing: cubicOut }}
						out:fly={{ x: -slideDir * 60, duration: 280, easing: cubicOut }}
					>
						{@render children()}
					</div>
				{/key}
			</div>
		</main>
	</div>
{/if}
