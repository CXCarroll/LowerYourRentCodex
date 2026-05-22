<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import GlassBackdrop from '$lib/components/GlassBackdrop.svelte';
	import BrandMark from '$lib/components/BrandMark.svelte';
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

	let activeTabIdx = $derived(Math.max(0, tabIndex(activeTab)));

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

	// Share-preview metadata (Open Graph + Twitter Card). URLs are absolute
	// and built from the current request's origin so they work on any host —
	// production, Railway preview deploys, localhost — without an env var.
	// Image is the apple-touch-icon as a placeholder; replace with /og.png
	// (1200×630) and flip twitter:card to summary_large_image once designed.
	const OG_TITLE = 'Lower Your Rent';
	const OG_DESCRIPTION =
		'Negotiate a better rent in under two minutes, backed by real market data.';
	let canonicalUrl = $derived(page.url.origin + page.url.pathname);
	let ogImage = $derived(page.url.origin + '/apple-touch-icon.png');
</script>

<svelte:head>
	<title>Lower Your Rent</title>

	<link rel="canonical" href={canonicalUrl} />

	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Lower Your Rent" />
	<meta property="og:title" content={OG_TITLE} />
	<meta property="og:description" content={OG_DESCRIPTION} />
	<meta property="og:url" content={canonicalUrl} />
	<meta property="og:image" content={ogImage} />
	<meta property="og:locale" content="en_US" />

	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={OG_TITLE} />
	<meta name="twitter:description" content={OG_DESCRIPTION} />
	<meta name="twitter:image" content={ogImage} />
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
				<nav
					aria-label="Primary"
					class="relative ml-auto flex flex-shrink-0"
					style="
						min-width: 168px;
						height: 30px;
						border-radius: 11px;
						background: rgba(30,30,40,0.06);
						padding: 2px;
						border: 0.5px solid rgba(30,30,40,0.08);
					"
				>
					<div
						class="absolute"
						style="
							top: 2px; bottom: 2px;
							left: calc({(activeTabIdx / TABS.length) * 100}% + 2px);
							width: calc({100 / TABS.length}% - 4px);
							border-radius: 9px;
							background: rgba(255,255,255,0.95);
							box-shadow: 0 1px 3px rgba(16,24,40,0.12), 0 0.5px 0 rgba(255,255,255,0.9) inset;
							transition: left 260ms cubic-bezier(0.32,0.72,0,1);
						"
						aria-hidden="true"
					></div>
					{#each TABS as tab (tab.value)}
						<a
							href={tab.href}
							aria-current={tab.value === activeTab ? 'page' : undefined}
							class="primary-nav-link flex-1 relative z-10"
							style="
								font-family: var(--font-sans);
								font-size: 10px;
								font-weight: 600;
								color: {tab.value === activeTab ? 'var(--ink)' : 'rgba(30,30,40,0.72)'};
								letter-spacing: 0;
								transition: color 180ms;
								padding: 0 2px;
								white-space: nowrap;
								border-radius: 9px;
							"
						>
							{tab.label}
						</a>
					{/each}
				</nav>
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

<style>
	.primary-nav-link {
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		text-decoration: none;
		min-width: 0;
	}

	.primary-nav-link:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--accent, #0f62fe) 72%, white);
		outline-offset: -2px;
	}
</style>
