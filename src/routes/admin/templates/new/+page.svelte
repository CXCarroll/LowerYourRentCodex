<script lang="ts">
	import type { PageProps } from './$types';
	import EmailTemplateForm from '$lib/components/admin/EmailTemplateForm.svelte';
	import type { TemplateAudience, TemplateAggressiveness } from '$lib/shared/email-template';

	let { form }: PageProps = $props();

	// Preserve typed input across a validation error. New templates start inactive.
	let initial = $derived({
		name: form?.name ?? '',
		body: form?.body ?? '',
		status: 'inactive' as const,
		audience: (form?.audience as TemplateAudience | undefined) ?? 'any',
		aggressiveness: (form?.aggressiveness as TemplateAggressiveness | undefined) ?? 'baseline'
	});

	let errorMessage = $derived(
		form && typeof form === 'object' && 'message' in form && typeof form.message === 'string'
			? (form.message as string)
			: null
	);
</script>

<section class="space-y-6">
	<header class="flex items-baseline justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-slate-900">New template</h1>
			<p class="mt-1 text-sm text-slate-500">
				Saved as inactive. Activate it from the edit screen once it's ready.
			</p>
		</div>
		<a href="/admin/templates" class="text-sm text-slate-500 hover:underline">← Back to templates</a>
	</header>

	<EmailTemplateForm template={initial} mode="new" {errorMessage} />
</section>
