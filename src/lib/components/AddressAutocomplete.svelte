<script lang="ts">
	// Glass-styled address autocomplete wrapping GlassInput.
	// Suggestions come from Mapbox via the same-origin /api/address/suggest
	// proxy. They are opportunistic: if the proxy returns nothing or the
	// network fails, the user can still free-type and submit.

	import { onDestroy } from 'svelte';
	import GlassInput from '$lib/components/GlassInput.svelte';
	import {
		suggestAddresses,
		type AddressCandidate
	} from '$lib/client/address-autocomplete';

	interface Props {
		value: string;
		onValue: (v: string) => void;
		id?: string;
		name?: string;
		placeholder?: string;
		ariaInvalid?: boolean;
		ariaLabelledby?: string;
		ariaDescribedby?: string;
		ariaErrormessage?: string;
	}

	const {
		value,
		onValue,
		id,
		name,
		placeholder,
		ariaInvalid,
		ariaLabelledby,
		ariaDescribedby,
		ariaErrormessage
	}: Props = $props();

	const LISTBOX_ID = `lyr-addr-list-${Math.random().toString(36).slice(2, 8)}`;

	let candidates = $state<AddressCandidate[]>([]);
	let highlighted = $state(-1);
	let open = $state(false);
	let loading = $state(false);
	let wrapRef: HTMLDivElement | undefined = $state();
	let listRef: HTMLUListElement | undefined = $state();
	/** Viewport coords for the portaled dropdown (see `portal` below). */
	let menuPos = $state({ left: 0, top: 0, width: 0, maxHeight: 0 });

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let controller: AbortController | null = null;
	/** The query that seeded the currently-displayed candidates; guards
	 *  against applying stale results after the user has typed further. */
	let lastQuery = '';
	/** Suppress the next query cycle after the user selects a candidate,
	 *  because the `value` update would otherwise re-trigger a search. */
	let suppressUntil = '';

	function queryIsReady(q: string): boolean {
		// Mapbox autocompletes partial entries, so a short prefix is enough.
		return q.trim().length >= 4;
	}

	function optionId(idx: number) {
		return `${LISTBOX_ID}-option-${idx}`;
	}

	const activeDescendant = $derived(
		open && highlighted >= 0 ? optionId(highlighted) : undefined
	);

	// The dropdown is rendered into <body> so it escapes the ancestor
	// `overflow: hidden` collapse-animation wrappers (CollapsibleField,
	// RentForm) that would otherwise clip it. It is positioned with
	// `position: fixed` from the input's viewport rect.
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}

	function reposition() {
		if (!wrapRef) return;
		const r = wrapRef.getBoundingClientRect();
		const top = r.bottom + 6;
		// Cap the height so the dropdown never runs past the viewport fold;
		// it scrolls internally if there are more matches than fit.
		const maxHeight = Math.max(140, window.innerHeight - top - 12);
		menuPos = { left: r.left, top, width: r.width, maxHeight };
	}

	function scheduleFetch(q: string) {
		if (debounceTimer) clearTimeout(debounceTimer);
		if (controller) controller.abort();
		if (!queryIsReady(q)) {
			candidates = [];
			open = false;
			loading = false;
			return;
		}
		debounceTimer = setTimeout(() => {
			void runFetch(q);
		}, 300);
	}

	async function runFetch(q: string) {
		controller = new AbortController();
		loading = true;
		const signal = controller.signal;
		try {
			const result = await suggestAddresses(q, signal);
			if (signal.aborted) return;
			lastQuery = q;
			candidates = result;
			highlighted = result.length > 0 ? 0 : -1;
			open = result.length > 0;
			if (open) reposition();
		} finally {
			if (!signal.aborted) loading = false;
		}
	}

	function handleValue(v: string) {
		onValue(v);
		if (v === suppressUntil) {
			// Selection echo; do not re-query.
			return;
		}
		suppressUntil = '';
		scheduleFetch(v);
	}

	function select(idx: number) {
		const c = candidates[idx];
		if (!c) return;
		suppressUntil = c.display;
		onValue(c.display);
		candidates = [];
		open = false;
		highlighted = -1;
		if (debounceTimer) clearTimeout(debounceTimer);
		if (controller) controller.abort();
	}

	function onKey(e: KeyboardEvent) {
		if (!open || candidates.length === 0) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			highlighted = (highlighted + 1) % candidates.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlighted = (highlighted - 1 + candidates.length) % candidates.length;
		} else if (e.key === 'Enter') {
			if (highlighted >= 0) {
				e.preventDefault();
				select(highlighted);
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			open = false;
		}
	}

	function onDocPointerDown(e: MouseEvent) {
		const target = e.target as Node;
		if (wrapRef?.contains(target) || listRef?.contains(target)) return;
		open = false;
	}

	$effect(() => {
		document.addEventListener('mousedown', onDocPointerDown);
		return () => document.removeEventListener('mousedown', onDocPointerDown);
	});

	// Keep the portaled dropdown anchored to the input while it's open.
	$effect(() => {
		if (!open) return;
		reposition();
		const sync = () => reposition();
		window.addEventListener('scroll', sync, true);
		window.addEventListener('resize', sync);
		return () => {
			window.removeEventListener('scroll', sync, true);
			window.removeEventListener('resize', sync);
		};
	});

	onDestroy(() => {
		if (debounceTimer) clearTimeout(debounceTimer);
		if (controller) controller.abort();
	});
</script>

<div bind:this={wrapRef} class="relative">
	<GlassInput
		{id}
		{name}
		{value}
		{placeholder}
		role="combobox"
		ariaControls={LISTBOX_ID}
		ariaExpanded={open}
		ariaHaspopup="listbox"
		ariaAutocomplete="list"
		ariaActivedescendant={activeDescendant}
		{ariaInvalid}
		{ariaLabelledby}
		{ariaDescribedby}
		{ariaErrormessage}
		autocomplete="street-address"
		onValue={handleValue}
		onKeydown={onKey}
	/>

	{#if loading}
		<div
			aria-hidden="true"
			style="
				position: absolute;
				right: 14px;
				top: 50%;
				transform: translateY(-50%);
				width: 14px;
				height: 14px;
				border-radius: 50%;
				border: 1.5px solid rgba(30,30,40,0.15);
				border-top-color: var(--accent-deep);
				animation: lyr-spin 600ms linear infinite;
				pointer-events: none;
			"
		></div>
	{/if}

	{#if open && candidates.length > 0}
		<ul
			bind:this={listRef}
			use:portal
			id={LISTBOX_ID}
			role="listbox"
			style="
				position: fixed;
				left: {menuPos.left}px;
				top: {menuPos.top}px;
				width: {menuPos.width}px;
				max-height: {menuPos.maxHeight}px;
				overflow-y: auto;
				z-index: 1000;
				list-style: none;
				margin: 0;
				padding: 6px;
				border-radius: 16px;
				background: rgba(255,255,255,0.85);
				backdrop-filter: blur(24px) saturate(180%);
				-webkit-backdrop-filter: blur(24px) saturate(180%);
				border: 0.5px solid var(--hairline);
					box-shadow:
						0 1px 0 rgba(255,255,255,0.9) inset,
						0 12px 32px -8px rgba(16,24,40,0.18);
			"
			>
				{#each candidates as c, i (c.display + i)}
					<!-- svelte-ignore a11y_click_events_have_key_events (keyboard selection stays on the input via aria-activedescendant) -->
					<li
						id={optionId(i)}
					role="option"
					aria-selected={i === highlighted}
					onpointerdown={(e) => {
						e.preventDefault();
						select(i);
					}}
					onclick={() => select(i)}
					onmouseenter={() => (highlighted = i)}
					class="address-suggestion-option w-full text-left"
					style="
						display: block;
						min-height: 44px;
						padding: 10px 12px;
						border: 0;
						border-radius: 12px;
						background: {i === highlighted ? 'var(--accent-ghost)' : 'transparent'};
						font-family: var(--font-sans);
						font-size: 15px;
						line-height: 1.35;
						color: var(--ink);
						cursor: pointer;
						transition: background 120ms ease;
					"
				>
					{c.display}
				</li>
			{/each}
		</ul>
	{/if}
</div>
