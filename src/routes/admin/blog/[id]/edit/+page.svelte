<script lang="ts">
	import type { PageProps } from './$types';
	import BlogPostForm from '$lib/components/admin/BlogPostForm.svelte';

	let { data, form }: PageProps = $props();

	let initial = $derived({
		id: data.post.id,
		title: data.post.title,
		slug: data.post.slug,
		excerpt: data.post.excerpt ?? '',
		coverImageUrl: data.post.coverImageUrl ?? '',
		content: data.post.content,
		status: data.post.status
	});

	let errorMessage = $derived(
		form && typeof form === 'object' && 'message' in form && typeof form.message === 'string'
			? (form.message as string)
			: null
	);
	let savedFlash = $derived(
		!!(form && typeof form === 'object' && 'saved' in form && form.saved === true)
	);

	let statusLabel = $derived(data.post.status === 'published' ? 'Published' : 'Draft');
</script>

<section class="space-y-6">
	<header class="flex items-baseline justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-slate-900">Edit post</h1>
			<p class="mt-1 text-sm text-slate-500">
				Status: <span class="font-medium text-slate-700">{statusLabel}</span>
				{#if data.post.publishedAt}
					· first published {new Date(data.post.publishedAt).toLocaleDateString(undefined, {
						year: 'numeric',
						month: 'short',
						day: 'numeric'
					})}
				{/if}
			</p>
		</div>
		<a href="/admin/blog" class="text-sm text-slate-500 hover:underline">← Back to posts</a>
	</header>

	<BlogPostForm post={initial} mode="edit" {errorMessage} {savedFlash} />
</section>
