<script lang="ts">
	import type { PageProps } from './$types';
	import BlogPostForm from '$lib/components/admin/BlogPostForm.svelte';

	let { form }: PageProps = $props();

	// Build the initial post from any returned form data so a validation error
	// doesn't blow away what the admin typed. New posts always start as drafts.
	let initial = $derived({
		title: form?.title ?? '',
		slug: form?.slugInput ?? '',
		excerpt: form?.excerpt ?? '',
		coverImageUrl: form?.coverImageUrl ?? '',
		content: form?.content ?? '',
		status: 'draft' as const
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
			<h1 class="text-xl font-semibold tracking-tight text-slate-900" tabindex="-1">New post</h1>
			<p class="mt-1 text-sm text-slate-500">Saves as a draft. You can publish it from the edit screen.</p>
		</div>
		<a href="/admin/blog" class="text-sm text-slate-500 hover:underline">← Back to posts</a>
	</header>

	<BlogPostForm post={initial} mode="new" {errorMessage} />
</section>
