<script lang="ts">
	// Wraps a labelled input so it can shrink to a single-line summary once
	// the user has entered a valid value. Tap the summary to re-expand.
	// Port of screens.jsx CollapsibleField. Uses the grid-template-rows
	// 1fr/0fr animation trick + opacity cross-fade.

	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		collapsed: boolean;
		summary: string;
		onEdit: () => void;
		error?: string;
		errorId?: string;
		hint?: string;
		hintId?: string;
		inputId?: string;
		children: Snippet;
	}

	const { label, collapsed, summary, onEdit, error, errorId, hint, hintId, inputId, children }: Props =
		$props();

	const ease = 'cubic-bezier(0.32,0.72,0,1)';
	const renderedErrorId = $derived(errorId ?? (inputId ? `${inputId}-error` : undefined));
</script>

<div class="relative">
	<!-- Collapsed summary row -->
	<div
		class="lyr-motion grid"
		style="
			grid-template-rows: {collapsed ? '1fr' : '0fr'};
			transition: grid-template-rows 340ms {ease};
		"
	>
		<div
			class="lyr-motion overflow-hidden"
			style="
				opacity: {collapsed ? 1 : 0};
				transition: opacity 200ms ease;
				transition-delay: {collapsed ? '160ms' : '0ms'};
			"
		>
			<button
				type="button"
				onclick={onEdit}
				aria-label={summary ? `Edit ${label}: ${summary}` : `Edit ${label}`}
				class="w-full flex items-center bg-transparent border-0 cursor-pointer text-left"
				style="padding: 2px 4px; gap: 12px;"
			>
				<span
					class="flex-shrink-0 whitespace-nowrap"
					style="
						font-family: var(--font-sans);
						font-size: 11px;
						font-weight: 600;
						letter-spacing: 0.8px;
						text-transform: uppercase;
						color: #1e1e28;
					"
				>
					{label}
				</span>
				<span
					class="flex-1 min-w-0 text-right truncate"
					style="
						font-family: var(--font-sans);
						font-size: 15px;
						font-weight: 500;
						color: #1e1e28;
						letter-spacing: -0.1px;
					"
				>
					{summary}
				</span>
				<svg
					width="11"
					height="11"
					viewBox="0 0 12 12"
					class="flex-shrink-0"
					style="color: rgba(30,30,40,0.4);"
				>
					<path
						d="M2 10l5-5 2 2-5 5H2v-2zM7 5l2 2"
						stroke="currentColor"
						stroke-width="1.3"
						fill="none"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</button>
		</div>
	</div>

	<!-- Expanded full field -->
	<div
		class="lyr-motion grid"
		style="
			grid-template-rows: {collapsed ? '0fr' : '1fr'};
			transition: grid-template-rows 340ms {ease};
		"
	>
		<div
			class="lyr-motion overflow-hidden"
			style="
				opacity: {collapsed ? 0 : 1};
				transition: opacity 200ms ease;
				transition-delay: {collapsed ? '0ms' : '160ms'};
			"
		>
			<div class="flex flex-col min-w-0" style="gap: 6px;">
				{#if inputId}
					<label
						for={inputId}
						style="
							font-family: var(--font-sans);
							font-size: 11px;
							font-weight: 600;
							letter-spacing: 0.8px;
							text-transform: uppercase;
							color: rgba(30,30,40,0.55);
						"
					>
						{label}
					</label>
				{:else}
					<span
						style="
							font-family: var(--font-sans);
							font-size: 11px;
							font-weight: 600;
							letter-spacing: 0.8px;
							text-transform: uppercase;
							color: rgba(30,30,40,0.55);
						"
					>
						{label}
					</span>
				{/if}
				{@render children()}
				{#if hint && !error}
					<div
						id={hintId}
						style="font-family: var(--font-sans); font-size: 12px; color: rgba(30,30,40,0.5); line-height: 1.45;"
					>
						{hint}
					</div>
				{/if}
				{#if error}
					<div
						id={renderedErrorId}
						style="font-family: var(--font-sans); font-size: 12px; color: #B42318;"
					>
						{error}
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
