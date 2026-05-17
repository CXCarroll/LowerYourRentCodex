<script lang="ts">
	// Shared editor used by /admin/templates/new and /admin/templates/[id]/edit.
	// Renders the name + body fields, a live preview filled with sample data,
	// a variable reference panel, and an unknown-placeholder warning.

	import { untrack } from 'svelte';
	import {
		VARIABLE_CATALOG,
		AUDIENCE_VALUES,
		AUDIENCE_LABELS,
		AGGRESSIVENESS_VALUES,
		AGGRESSIVENESS_LABELS,
		renderTemplate,
		findUnknownPlaceholders,
		sampleValuesForAudience,
		type TemplateAudience,
		type TemplateAggressiveness
	} from '$lib/shared/email-template';

	type Status = 'active' | 'inactive';

	interface Props {
		template: {
			id?: string;
			name: string;
			body: string;
			status: Status;
			audience: TemplateAudience;
			aggressiveness: TemplateAggressiveness;
		};
		mode: 'new' | 'edit';
		errorMessage?: string | null;
		savedFlash?: boolean;
	}

	let { template, mode, errorMessage = null, savedFlash = false }: Props = $props();

	// One-shot capture from the prop (parent re-renders with fresh props after
	// a save round-trip).
	let name = $state(untrack(() => template.name));
	let body = $state(untrack(() => template.body));
	let audience = $state(untrack(() => template.audience));
	let aggressiveness = $state(untrack(() => template.aggressiveness));

	// Preview sample tracks the chosen audience so below-market copy previews
	// with "below" wording.
	let preview = $derived(renderTemplate(body, sampleValuesForAudience(audience)));
	let unknownPlaceholders = $derived(findUnknownPlaceholders(body));

	function confirmDelete(e: Event) {
		// eslint-disable-next-line no-alert
		if (!confirm('Delete this template permanently? This cannot be undone.')) {
			e.preventDefault();
		}
	}
</script>

<div class="grid gap-6 lg:grid-cols-[1fr_320px]">
	<form method="POST" class="card space-y-5 p-6">
		{#if errorMessage}
			<p class="rounded-md bg-red-50 p-3 text-sm text-red-800">{errorMessage}</p>
		{/if}
		{#if savedFlash}
			<p class="rounded-md bg-brand-50 p-3 text-sm text-brand-700">Saved ✓</p>
		{/if}

		<div class="space-y-1.5">
			<label for="tpl-name" class="text-xs font-medium tracking-wide text-slate-500 uppercase">
				Name
			</label>
			<input
				id="tpl-name"
				name="name"
				class="field-input"
				type="text"
				required
				maxlength="160"
				bind:value={name}
				placeholder="Friendly — open to staying"
			/>
			<p class="text-xs text-slate-500">Internal label only. Tenants never see this.</p>
		</div>

		<div class="space-y-1.5">
			<label for="tpl-audience" class="text-xs font-medium tracking-wide text-slate-500 uppercase">
				Audience
			</label>
			<select id="tpl-audience" name="audience" class="field-input" bind:value={audience}>
				{#each AUDIENCE_VALUES as a (a)}
					<option value={a}>{AUDIENCE_LABELS[a]}</option>
				{/each}
			</select>
			<p class="text-xs text-slate-500">
				Who this template is served to. Above/below-market templates are only offered to
				tenants whose rent is above/below the neighborhood median; “Any tenant” templates are
				shown to everyone.
			</p>
		</div>

		<div class="space-y-1.5">
			<label
				for="tpl-aggressiveness"
				class="text-xs font-medium tracking-wide text-slate-500 uppercase"
			>
				Aggressiveness
			</label>
			<select
				id="tpl-aggressiveness"
				name="aggressiveness"
				class="field-input"
				bind:value={aggressiveness}
			>
				{#each AGGRESSIVENESS_VALUES as a (a)}
					<option value={a}>{AGGRESSIVENESS_LABELS[a]}</option>
				{/each}
			</select>
			<p class="text-xs text-slate-500">
				Tone tier behind the tenant-facing toggle. One template is picked at random per
				tier, and each tier asks for a different rent cut: “Baseline” the smallest,
				“Very aggressive” the algorithm's full recommended reduction.
			</p>
		</div>

		<div class="space-y-1.5">
			<label for="tpl-body" class="text-xs font-medium tracking-wide text-slate-500 uppercase">
				Body
			</label>
			<textarea
				id="tpl-body"
				name="body"
				class="field-input font-mono text-sm"
				rows="16"
				required
				maxlength="20000"
				bind:value={body}
				placeholder={'Hi [Landlord name],\n\nMy rent of {{current_rent}} is about {{pct_above_median}}% above the {{median_rent}} median…\n\n— [Your name]'}
			></textarea>
			<p class="text-xs text-slate-500">
				Use <code class="rounded bg-slate-100 px-1">{'{{variable}}'}</code> placeholders (see
				the reference). Keep <code class="rounded bg-slate-100 px-1">[Landlord name]</code> and
				<code class="rounded bg-slate-100 px-1">[Your name]</code> as literal text — the tenant
				fills those in.
			</p>
		</div>

		{#if unknownPlaceholders.length > 0}
			<div class="rounded-md border border-amber-200 bg-amber-50 p-3">
				<p class="text-sm font-semibold text-amber-800">Unrecognized placeholders</p>
				<p class="mt-1 text-xs text-amber-800">
					These aren't in the variable catalog and will appear literally in the email:
					{#each unknownPlaceholders as p, i (p)}<code class="font-mono"
							>{`{{${p}}}`}</code
						>{i < unknownPlaceholders.length - 1 ? ', ' : ''}{/each}
				</p>
			</div>
		{/if}

		<div class="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5">
			{#if mode === 'new'}
				<button type="submit" class="btn-primary">Create template</button>
				<a href="/admin/templates" class="text-sm text-slate-500 hover:underline">Cancel</a>
			{:else}
				<button type="submit" formaction="?/save" class="btn-primary">Save changes</button>
				{#if template.status === 'inactive'}
					<button type="submit" formaction="?/activate" class="btn-secondary">Activate</button>
				{:else}
					<button type="submit" formaction="?/deactivate" class="btn-secondary">
						Deactivate
					</button>
				{/if}
				<button
					type="submit"
					formaction="?/delete"
					onclick={confirmDelete}
					class="ml-auto text-sm font-medium text-red-600 hover:text-red-700 hover:underline"
				>
					Delete
				</button>
			{/if}
		</div>
	</form>

	<aside class="space-y-5">
		<div class="card p-5">
			<p class="text-xs font-medium tracking-wide text-slate-500 uppercase">Live preview</p>
			<p class="mt-1 text-xs text-slate-400">Placeholders filled with sample data.</p>
			<pre
				class="mt-3 max-h-80 overflow-auto rounded-lg bg-slate-50 p-3 text-xs whitespace-pre-wrap text-slate-700">{preview}</pre>
		</div>

		<div class="card p-5">
			<p class="text-xs font-medium tracking-wide text-slate-500 uppercase">Variables</p>
			<ul class="mt-3 space-y-2.5">
				{#each VARIABLE_CATALOG as v (v.key)}
					<li>
						<code class="rounded bg-slate-100 px-1 font-mono text-xs text-slate-800"
							>{`{{${v.key}}}`}</code
						>
						<p class="mt-0.5 text-xs text-slate-500">{v.description}</p>
					</li>
				{/each}
			</ul>
		</div>
	</aside>
</div>
