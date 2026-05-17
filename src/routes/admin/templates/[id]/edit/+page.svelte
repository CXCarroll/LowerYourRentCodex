<script lang="ts">
	import type { PageProps } from './$types';
	import EmailTemplateForm from '$lib/components/admin/EmailTemplateForm.svelte';

	let { data, form }: PageProps = $props();

	let initial = $derived({
		id: data.template.id,
		name: data.template.name,
		body: data.template.body,
		status: data.template.status,
		audience: data.template.audience,
		aggressiveness: data.template.aggressiveness
	});

	let errorMessage = $derived(
		form && typeof form === 'object' && 'message' in form && typeof form.message === 'string'
			? (form.message as string)
			: null
	);
	let savedFlash = $derived(
		!!(form && typeof form === 'object' && 'saved' in form && form.saved === true)
	);

	let statusLabel = $derived(data.template.status === 'active' ? 'Active' : 'Inactive');
</script>

<section class="space-y-6">
	<header class="flex items-baseline justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-slate-900">Edit template</h1>
			<p class="mt-1 text-sm text-slate-500">
				Status: <span class="font-medium text-slate-700">{statusLabel}</span>
				{#if data.template.status === 'active'}
					· in the random rotation served to users
				{:else}
					· not served until activated
				{/if}
			</p>
		</div>
		<a href="/admin/templates" class="text-sm text-slate-500 hover:underline">← Back to templates</a>
	</header>

	<EmailTemplateForm template={initial} mode="edit" {errorMessage} {savedFlash} />
</section>
